"""
Container routes -- download bundle only.

The per-user Docker container management (deploy / stop / status / proxy) has been
replaced by the embedded 5-worker agent pool.  The only remaining endpoint here is
GET /api/containers/download which lets users self-host the agent container locally.
"""
import io
import logging
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from utils import container_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/containers", tags=["containers"])

_src_root = Path(__file__).resolve().parents[2]
_CONTAINER_DOCKER_DIR = (
    _src_root / "Container" / "docker"
    if (_src_root / "Container").exists()
    else _src_root.parent / "Container" / "docker"
)


@router.get("/download")
def download_bundle():
    """
    Build a ZIP containing the Docker image tar + helper scripts so users
    can run the agent container locally (self-hosted mode).
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        try:
            image_bytes = container_manager.save_image_bytes()
            zf.writestr("licenta-container.tar", image_bytes)
        except Exception as exc:
            logger.error("Failed to export container image: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to export container image: {exc}")

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
