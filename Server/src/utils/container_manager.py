"""
Container manager -- kept only for producing the ZIP download bundle.

The per-user Docker container model has been replaced by the embedded
agent pool (utils/agent_pool.py).  This module's only remaining job is
to export the agent image as a tar so the download endpoint can bundle it.
"""
import logging
from pathlib import Path

import docker
from docker.errors import ImageNotFound, DockerException

from config import settings

logger = logging.getLogger(__name__)

_CONTAINER_DIR = Path(__file__).resolve().parents[2] / "Container"
_RUNTIME_DOCKERFILE = "Dockerfile.runtime"


def _get_client() -> docker.DockerClient:
    try:
        client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
        client.ping()
        return client
    except DockerException as exc:
        raise RuntimeError(
            "Docker socket is not available -- image export requires a host with Docker. "
            f"Detail: {exc}"
        ) from exc


def _ensure_image(client: docker.DockerClient) -> None:
    try:
        client.images.get(settings.CONTAINER_IMAGE_NAME)
        return
    except ImageNotFound:
        pass

    if not _CONTAINER_DIR.exists():
        raise DockerException(
            f"Container source not found at {_CONTAINER_DIR}. "
            "Was the server image built correctly?"
        )

    logger.info(
        "Agent image '%s' not found -- building from embedded source at %s ...",
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
    logger.info("Agent image built: %s", settings.CONTAINER_IMAGE_NAME)


def save_image_bytes() -> bytes:
    """Export the container image as a tar archive (for ZIP download)."""
    client = _get_client()
    _ensure_image(client)
    image = client.images.get(settings.CONTAINER_IMAGE_NAME)
    return b"".join(image.save(named=True))
