import sys
import os
from pathlib import Path

# Make sure local packages are importable when run from src/
sys.path.insert(0, str(Path(__file__).parent))          # Server/src  → config, utils, API
sys.path.insert(0, str(Path(__file__).parent.parent))   # Server/     → Database package

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from Database.session import engine
from Database.models import Base
from API.auth_routes import router as auth_router
from API.agent_routes import router as agent_router
from API.ai_gateway.router import router as ai_gateway_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup (Alembic handles migrations in prod)
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured")

    if settings.ALLOWED_ORIGINS == ["*"]:
        logger.warning(
            "CORS is set to allow all origins ('*'). "
            "Set ALLOWED_ORIGINS in .env for production deployments."
        )
    if not settings.GROQ_API_KEY:
        logger.warning(
            "GROQ_API_KEY is not set — the planning agent and AI gateway LLM endpoints will not work. "
            "Set GROQ_API_KEY in .env."
        )
    logger.info("Groq model: %s", settings.GROQ_MODEL)

    yield

    logger.info("Server shutting down")


app = FastAPI(
    title="Licenta Server",
    description="Account management, container orchestration, and proxy layer for the Licenta platform.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(agent_router)
app.include_router(ai_gateway_router)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "version": "1.0.0"}



_interface_dist = Path(__file__).parent.parent / "Interface" / "dist"
if _interface_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_interface_dist / "assets")), name="spa-assets")

    # This is what makes React Router work on hard reload / direct URL access
    # no-cache so the browser always re-validates index.html and picks up new bundle hashes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index = _interface_dist / "index.html"
        return FileResponse(
            str(index),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
else:
    logger.warning("Interface/dist not found — run `npm run build` inside Server/Interface first")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
