"""
Container routes.

Two hosting modes:
  server_hosted — server spawns the container via Docker; requests proxied through /proxy/
  self_hosted   — user downloads the ZIP bundle, runs locally, registers their URL directly
"""

import io
import zipfile
import logging
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from Database.session import get_db
from Database.models import Container, ContainerMode, ContainerStatus, User
from utils.auth import get_current_user
from utils import container_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/containers", tags=["containers"])

_src_root = Path(__file__).resolve().parents[2]
_CONTAINER_DOCKER_DIR = (
    _src_root / "Container" / "docker"
    if (_src_root / "Container").exists()
    else _src_root.parent / "Container" / "docker"
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class DeployIn(BaseModel):
    mode: ContainerMode = ContainerMode.server_hosted
    name: str | None = None
    self_hosted_url: str | None = None


class ContainerOut(BaseModel):
    id: str
    mode: str
    status: str
    internal_url: str | None
    api_key: str

    class Config:
        from_attributes = True


# ── Download bundle ───────────────────────────────────────────────────────────

@router.get("/download")
def download_bundle():
    """
    Stream a ZIP containing the Docker image tar + run scripts + README.
    Users extract and run locally for self-hosted mode.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Export the pre-built image as a tar (no build at request time)
        try:
            image_bytes = container_manager.save_image_bytes()
            zf.writestr("licenta-container.tar", image_bytes)
        except Exception as exc:
            logger.error("Failed to export container image: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to export container image. Make sure licenta-container:latest is built: {exc}")

        # Include run scripts, .env.example and README
        for filename in ("run.sh", "run.bat", ".env.example", "README.md"):
            src_file = _CONTAINER_DOCKER_DIR / filename
            if src_file.exists():
                zf.write(src_file, arcname=filename)
            else:
                logger.warning("Bundle file not found: %s", src_file)

    buf.seek(0)
    return StreamingResponse(
        content=buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="licenta-container-bundle.zip"'},
    )


# ── Deploy ────────────────────────────────────────────────────────────────────

@router.post("/deploy", response_model=ContainerOut, status_code=status.HTTP_201_CREATED)
def deploy(
    body: DeployIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.query(Container).filter(Container.user_id == current_user.id).first()
    if existing:
        if existing.status == ContainerStatus.running:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A container is already running for your account. Stop it before deploying a new one.",
            )
        db.delete(existing)
        db.commit()

    api_key = str(uuid.uuid4())

    if body.mode == ContainerMode.server_hosted:
        try:
            docker_id, internal_url = container_manager.deploy_container(
                user_id=str(current_user.id),
                container_api_key=api_key,
                google_api_key=settings.GOOGLE_API_KEY,
                name=body.name,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:
            logger.exception("Docker deploy failed")
            raise HTTPException(status_code=500, detail=f"Container deployment failed: {exc}")

        record = Container(
            user_id=current_user.id,
            mode=ContainerMode.server_hosted,
            internal_url=internal_url,
            docker_container_id=docker_id,
            status=ContainerStatus.running,
            api_key=api_key,
            google_api_key=settings.GOOGLE_API_KEY,
        )
    else:
        if not body.self_hosted_url:
            raise HTTPException(status_code=422, detail="self_hosted_url is required for self_hosted mode")

        record = Container(
            user_id=current_user.id,
            mode=ContainerMode.self_hosted,
            internal_url=body.self_hosted_url.rstrip("/"),
            docker_container_id=None,
            status=ContainerStatus.running,
            api_key=api_key,
        )

    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_out(record)


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=ContainerOut)
async def get_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = _get_or_404(current_user.id, db)

    if record.mode == ContainerMode.server_hosted and record.docker_container_id:
        live = container_manager.get_container_status(record.docker_container_id)
        new_status = ContainerStatus.running if live == "running" else ContainerStatus.stopped
        if record.status != new_status:
            record.status = new_status
            db.commit()
    elif record.mode == ContainerMode.self_hosted and record.internal_url:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{record.internal_url}/health")
            new_status = ContainerStatus.running if r.status_code < 500 else ContainerStatus.stopped
        except Exception:
            new_status = ContainerStatus.stopped
        if record.status != new_status:
            record.status = new_status
            db.commit()

    return _to_out(record)


# ── Stop ──────────────────────────────────────────────────────────────────────

@router.delete("/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = _get_or_404(current_user.id, db)

    if record.mode == ContainerMode.server_hosted and record.docker_container_id:
        try:
            container_manager.stop_container(record.docker_container_id)
        except Exception as exc:
            logger.warning("Could not stop docker container: %s", exc)

    record.status = ContainerStatus.stopped
    record.docker_container_id = None
    db.commit()


# ── Proxy (server-hosted only) ────────────────────────────────────────────────

@router.api_route("/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy(
    path: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Forward requests to the user's server-hosted container, injecting its API key."""
    record = _get_or_404(current_user.id, db)

    if record.mode != ContainerMode.server_hosted:
        raise HTTPException(
            status_code=400,
            detail="Proxy is only for server-hosted containers. Connect directly to your self-hosted container.",
        )
    if record.status != ContainerStatus.running or not record.internal_url:
        raise HTTPException(status_code=503, detail="Container is not running")

    target_url = f"{record.internal_url.rstrip('/')}/{path}"
    body_bytes = await request.body()

    forward_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length")
    }
    forward_headers["X-API-Key"] = record.api_key

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=forward_headers,
                params=dict(request.query_params),
                content=body_bytes,
            )
        except httpx.ConnectError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach container: {exc}")

    return StreamingResponse(
        content=iter([resp.content]),
        status_code=resp.status_code,
        headers=dict(resp.headers),
    )


# ── Proxy by API key (service-to-service, no JWT) ────────────────────────────

@router.api_route("/proxy-key/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_by_key(
    path: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Forward requests to a container using only the container's API key.
    This is a service-level endpoint — no user JWT is required.
    The API key identifies the container on the server side.
    """
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )

    record = db.query(Container).filter(Container.api_key == api_key).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    if record.mode != ContainerMode.server_hosted:
        raise HTTPException(
            status_code=400,
            detail="This container is self-hosted; connect to it directly using its URL and API key.",
        )
    if record.status != ContainerStatus.running or not record.internal_url:
        raise HTTPException(status_code=503, detail="Container is not running")

    target_url = f"{record.internal_url.rstrip('/')}/{path}"
    body_bytes = await request.body()

    forward_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "x-api-key", "content-length")
    }
    forward_headers["X-API-Key"] = record.api_key

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=forward_headers,
                params=dict(request.query_params),
                content=body_bytes,
            )
        except httpx.ConnectError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach container: {exc}")

    return StreamingResponse(
        content=iter([resp.content]),
        status_code=resp.status_code,
        headers=dict(resp.headers),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_404(user_id, db: Session) -> Container:
    record = db.query(Container).filter(Container.user_id == user_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="No container registered for your account")
    return record


def _to_out(record: Container) -> ContainerOut:
    return ContainerOut(
        id=str(record.id),
        mode=record.mode.value,
        status=record.status.value,
        internal_url=record.internal_url,
        api_key=record.api_key,
    )