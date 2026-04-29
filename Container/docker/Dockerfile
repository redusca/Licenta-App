# ── Container image ───────────────────────────────────────────────────────────
# Build: docker build -t licenta-container:latest -f Container/docker/Dockerfile .
# Run:   docker run -p 8001:8001 --env-file Container/docker/.env licenta-container:latest

FROM python:3.12-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache-friendly)
COPY Container/src/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY Container/src/ ./

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
