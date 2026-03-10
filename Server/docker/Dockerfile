# ── Server image ──────────────────────────────────────────────────────────────
# Build from the repo root:
#   docker build -t licenta-server:latest -f Server/docker/Dockerfile .
#
# The image expects the React SPA to be pre-built at Server/Interface/dist/.
# Build it first:
#   cd Server/Interface && npm install && npm run build

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY Server/src/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY Server/src/ ./src/
COPY Server/Database/ ./Database/
COPY Server/migrations/ ./migrations/
COPY Server/alembic.ini ./alembic.ini

# Built React interface (must be pre-built)
COPY Server/Interface/dist/ ./Interface/dist/

# Container source + Dockerfile (needed so the server can build the agent image at runtime via Docker socket)
RUN mkdir -p ./Container/docker ./Container/src
COPY Container/docker/Dockerfile         ./Container/docker/Dockerfile
COPY Container/docker/Dockerfile.runtime ./Container/Dockerfile.runtime
COPY Container/docker/run.sh     ./Container/docker/run.sh
COPY Container/docker/run.bat    ./Container/docker/run.bat
COPY Container/docker/README.md  ./Container/docker/README.md
COPY Container/src/              ./Container/src/

# Release binaries — copy from APP/release/, rename spaces to dashes
RUN mkdir -p ./downloads
COPY APP/release/ ./downloads_tmp/
RUN for f in ./downloads_tmp/*.exe; do \
      dest="./downloads/$(basename "$f" | sed 's/ /-/g')"; \
      cp "$f" "$dest"; \
    done && rm -rf ./downloads_tmp

# Make src importable
ENV PYTHONPATH=/app/src:/app

EXPOSE 8080

# Run Alembic migrations then start the server
# Cloud Run injects PORT env var; fall back to 8080 if not set
CMD ["sh", "-c", "cd /app && python -m alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
