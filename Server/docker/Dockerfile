# -- Server image (Production) ------------------------------------------------
# Build from the repo root:
#   docker build -t licenta-server:latest -f Server/docker/Dockerfile .
#
# Pre-requisites:
#   Set GOOGLE_API_KEY, JWT_SECRET, REDIS_URL, DATABASE_URL via env / .env
#
# Services required at runtime: PostgreSQL, Redis

# ── Stage 1: Build the React SPA ─────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/Interface
COPY Server/Interface/package.json Server/Interface/package-lock.json* ./
RUN npm ci
COPY Server/Interface/ ./
RUN npm run build

# ── Stage 2: Python server ────────────────────────────────────────────────────
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies — two layers; torch/torchvision use CPU-only wheels (~250 MB).
COPY Server/src/requirements.txt ./requirements.txt
RUN grep -v -E '^\s*(torch|torchvision)\b' requirements.txt \
    | grep -v '^\s*$' > requirements-base.txt && \
    pip install --no-cache-dir --timeout 300 --retries 5 -r requirements-base.txt
RUN pip install --no-cache-dir --timeout 300 --retries 5 \
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
