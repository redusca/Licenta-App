# syntax=docker/dockerfile:1
# -- Server image (Production) ------------------------------------------------
# Build from the repo root:
#   docker build -t licenta-server:latest -f Server/docker/Dockerfile .
#
# Pre-requisites:
#   Set GOOGLE_API_KEY, JWT_SECRET, DATABASE_URL via env / .env
#
# Services required at runtime: PostgreSQL

# ── Stage 1: Build the React SPA ─────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/Interface
COPY Server/Interface/package.json Server/Interface/package-lock.json* ./
# BuildKit cache: node_modules are NOT re-downloaded if package-lock.json is unchanged.
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY Server/Interface/ ./
RUN npm run build

# ── Stage 2: Python server ────────────────────────────────────────────────────
FROM python:3.12-slim

# BuildKit cache: apt packages are persisted between builds — no re-download on source changes.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libsndfile1 \
    ffmpeg

WORKDIR /app

# Python dependencies — two layers; torch/torchvision use CPU-only wheels (~250 MB).
# BuildKit cache: pip wheels are reused across builds; torch layer is only re-run when
# requirements.txt changes (not on every source file change).
COPY Server/src/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    grep -v -E '^\s*(torch|torchvision)\b' requirements.txt \
    | grep -v '^\s*$' > requirements-base.txt && \
    pip install --timeout 300 --retries 5 -r requirements-base.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --timeout 300 --retries 5 \
      --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision

# Application source
COPY Server/src/ ./src/
COPY Server/Database/ ./Database/
COPY Server/migrations/ ./migrations/
COPY Server/alembic.ini ./alembic.ini

# Built React interface (from frontend stage)
COPY --from=frontend /app/Interface/dist/ ./Interface/dist/

# Make src importable
ENV PYTHONPATH=/app/src:/app

EXPOSE 8080

# Run Alembic migrations then start the server
# Cloud Run injects PORT env var; fall back to 8080 if not set
CMD ["sh", "-c", "cd /app && python -m alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
