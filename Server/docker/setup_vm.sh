#!/usr/bin/env bash
# setup_vm.sh — Runs ON the GCE VM (copied there by deploy_gce.sh).
# Installs Docker, authenticates with Artifact Registry, pulls the server
# image, and starts the full stack with Docker Compose.
#
# You can also run this manually on a fresh Debian/Ubuntu VM:
#   chmod +x setup_vm.sh && ./setup_vm.sh

set -euo pipefail

PROJECT="licenta-ubb"
REGION="europe-west10"
AR_HOST="${REGION}-docker.pkg.dev"
SERVER_IMAGE="${AR_HOST}/${PROJECT}/licenta-server/server:latest"
COMPOSE_DIR="${HOME}/licenta/docker"

# ── 1. Install Docker (official get.docker.com script) ───────────────────────
if ! command -v docker &>/dev/null; then
    echo "==> Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "${USER}"
    echo "     Docker installed."
else
    echo "==> Docker already installed, skipping."
fi

# ── 2. Install Docker Compose v2 plugin ──────────────────────────────────────
if ! sudo docker compose version &>/dev/null 2>&1; then
    echo "==> Installing Docker Compose plugin..."
    sudo apt-get install -y --no-install-recommends docker-compose-plugin
else
    echo "==> Docker Compose plugin already installed, skipping."
fi

# ── 3. Authenticate with Google Artifact Registry ────────────────────────────
echo "==> Authenticating with Artifact Registry (${AR_HOST})..."
# The VM's service account has the cloud-platform scope, so gcloud auth works.
gcloud auth configure-docker "${AR_HOST}" --quiet

# ── 4. Pull the latest server image ──────────────────────────────────────────
echo "==> Pulling server image: ${SERVER_IMAGE}..."
sudo docker pull "${SERVER_IMAGE}"

# ── 5. Create the shared Docker network (idempotent) ─────────────────────────
echo "==> Ensuring licenta-agents network exists..."
sudo docker network create licenta-agents 2>/dev/null || echo "     (network already exists)"

# ── 6. Start the stack ────────────────────────────────────────────────────────
echo "==> Starting services with Docker Compose..."
cd "${COMPOSE_DIR}"
sudo docker compose pull postgres   # ensure latest postgres image
sudo docker compose up -d --remove-orphans

# ── 7. Health check ───────────────────────────────────────────────────────────
echo "==> Waiting for server to become healthy..."
for i in $(seq 1 12); do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
    if [[ "${HTTP_STATUS}" == "200" ]]; then
        echo "     Server is healthy (HTTP 200)."
        break
    fi
    echo "     ... waiting (attempt ${i}/12, last status: ${HTTP_STATUS})"
    sleep 5
done

echo ""
echo "==> Stack running. Useful commands:"
echo "    sudo docker compose -f ${COMPOSE_DIR}/docker-compose.yml ps"
echo "    sudo docker compose -f ${COMPOSE_DIR}/docker-compose.yml logs -f"
echo "    sudo docker compose -f ${COMPOSE_DIR}/docker-compose.yml restart server"
echo ""
echo "==> To update the server image later:"
echo "    sudo docker pull ${SERVER_IMAGE}"
echo "    cd ${COMPOSE_DIR} && sudo docker compose up -d --no-deps server"
