import logging
from pathlib import Path

import docker
from docker.errors import NotFound, ImageNotFound, DockerException

from config import settings

logger = logging.getLogger(__name__)

# Path to the Container directory baked into the server image at /app/Container/
_CONTAINER_DIR = Path(__file__).resolve().parents[2] / "Container"
# Dockerfile.runtime uses paths relative to _CONTAINER_DIR as build context
_RUNTIME_DOCKERFILE = "Dockerfile.runtime"


def _get_client() -> docker.DockerClient:
    try:
        client = docker.DockerClient(base_url=settings.DOCKER_SOCKET)
        client.ping()  # fail fast if socket is unavailable
        return client
    except DockerException as exc:
        raise RuntimeError(
            "Docker socket is not available on this host. "
            "Container management requires a VM with Docker installed. "
            f"Detail: {exc}"
        ) from exc


def _ensure_image(client: docker.DockerClient) -> None:
    """
    Make sure the agent container image exists on the Docker host.
    If not present, build it from the source code that is baked into
    the server image at /app/Container/.  This happens automatically on
    first deploy so no manual image push is ever needed.
    """
    try:
        client.images.get(settings.CONTAINER_IMAGE_NAME)
        return  # already present
    except ImageNotFound:
        pass

    if not _CONTAINER_DIR.exists():
        raise DockerException(
            f"Container source not found at {_CONTAINER_DIR}. "
            "Was the server image built correctly?"
        )

    logger.info(
        "Agent image '%s' not found — building from embedded source at %s ...",
        settings.CONTAINER_IMAGE_NAME,
        _CONTAINER_DIR,
    )

    image, build_logs = client.images.build(
        path=str(_CONTAINER_DIR),
        dockerfile=_RUNTIME_DOCKERFILE,
        tag=settings.CONTAINER_IMAGE_NAME,
        rm=True,
        forcerm=True,
    )
    for chunk in build_logs:
        line = chunk.get("stream", "").strip()
        if line:
            logger.debug("BUILD | %s", line)

    logger.info("Agent image built successfully: %s", settings.CONTAINER_IMAGE_NAME)


def deploy_container(
    user_id: str,
    container_api_key: str,
    google_api_key: str,
    name: str | None = None,
) -> tuple[str, str]:
    """
    Spawn a new licenta-container Docker container for the given user.
    Builds the image from embedded source if it is not already present.
    Returns (docker_container_id, internal_url).
    """
    client = _get_client()

    # Build the agent image from embedded source if not already on the host
    _ensure_image(client)

    safe_name = name.strip().lower().replace(' ', '-')[:24] if name else user_id[:8]
    container_name = f"licenta-agent-{safe_name}"

    try:
        old = client.containers.get(container_name)
        old.remove(force=True)
        logger.info("Removed stale container %s", container_name)
    except NotFound:
        pass

    network = settings.CONTAINER_NETWORK or None

    run_kwargs: dict = dict(
        image=settings.CONTAINER_IMAGE_NAME,
        name=container_name,
        detach=True,
        environment={
            "GOOGLE_API_KEY": google_api_key,
            "CONTAINER_API_KEY": container_api_key,
            "MODEL_NAME": settings.MODEL_NAME,
        },
        labels={"licenta.user_id": str(user_id)},
        ports={f"{settings.CONTAINER_INTERNAL_PORT}/tcp": None},
    )
    if network:
        run_kwargs["network"] = network

    container = client.containers.run(**run_kwargs)
    container.reload()

    if network:
        internal_url = f"http://{container_name}:{settings.CONTAINER_INTERNAL_PORT}"
    else:
        host_port = container.ports[f"{settings.CONTAINER_INTERNAL_PORT}/tcp"][0]["HostPort"]
        internal_url = f"http://localhost:{host_port}"

    logger.info("Deployed container %s for user %s at %s", container.short_id, user_id, internal_url)
    return container.id, internal_url


def stop_container(docker_container_id: str) -> None:
    """Stop and remove a running container."""
    client = _get_client()
    try:
        container = client.containers.get(docker_container_id)
        container.stop(timeout=10)
        container.remove()
        logger.info("Stopped and removed container %s", docker_container_id[:12])
    except NotFound:
        logger.warning("Container %s not found — already removed?", docker_container_id[:12])
    except DockerException as exc:
        logger.error("Failed to stop container %s: %s", docker_container_id[:12], exc)
        raise


def get_container_status(docker_container_id: str) -> str:
    """Return Docker status string: 'running', 'exited', 'paused', etc."""
    client = _get_client()
    try:
        container = client.containers.get(docker_container_id)
        container.reload()
        return container.status
    except NotFound:
        return "not_found"
    except DockerException as exc:
        logger.error("Status check failed for %s: %s", docker_container_id[:12], exc)
        return "error"


def save_image_bytes() -> bytes:
    """Export the pre-built container image as a tar stream (for the download bundle)."""
    client = _get_client()
    image = client.images.get(settings.CONTAINER_IMAGE_NAME)
    return b"".join(image.save(named=True))

