#!/usr/bin/env bash
# deploy_gce.sh — Run this ONCE from the repo root to create a GCE VM and deploy
# the Licenta Server stack on it via Docker Compose.
#
# Prerequisites (on your local machine):
#   - gcloud CLI installed and authenticated  (gcloud auth login)
#   - gcloud configured for the project      (gcloud config set project licenta-ubb)
#   - Server/src/.env populated from .env.example
#   - Server image already pushed to Artifact Registry (docker push ...)
#
# Usage:
#   chmod +x Server/docker/deploy_gce.sh
#   ./Server/docker/deploy_gce.sh

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT="licenta-ubb"
ZONE="europe-west10-a"
INSTANCE="licenta-server-vm"
MACHINE_TYPE="e2-standard-2"       # 2 vCPU, 8 GB RAM — adjust as needed
BOOT_DISK_SIZE="30GB"
IMAGE_FAMILY="debian-12"
IMAGE_PROJECT="debian-cloud"
FIREWALL_TAG="licenta-server"
SERVER_PORT="8000"
# ──────────────────────────────────────────────────────────────────────────────

echo "==> [1/6] Creating GCE VM '${INSTANCE}' in zone '${ZONE}'..."
gcloud compute instances create "${INSTANCE}" \
    --project="${PROJECT}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --image-family="${IMAGE_FAMILY}" \
    --image-project="${IMAGE_PROJECT}" \
    --tags="${FIREWALL_TAG}" \
    --scopes=cloud-platform \
    --boot-disk-size="${BOOT_DISK_SIZE}" \
    --boot-disk-type=pd-balanced

echo "==> [2/6] Opening firewall for port ${SERVER_PORT}..."
gcloud compute firewall-rules create allow-licenta-server \
    --project="${PROJECT}" \
    --allow="tcp:${SERVER_PORT}" \
    --target-tags="${FIREWALL_TAG}" \
    --description="Allow Licenta server API traffic" \
    --quiet 2>/dev/null || echo "     (firewall rule already exists, skipping)"

echo "==> [3/6] Waiting for SSH to become available..."
# gcloud scp/ssh can fail immediately after instance creation; retry a few times
for i in $(seq 1 10); do
    gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" \
        --command="echo ok" --quiet 2>/dev/null && break || true
    echo "     ... retrying in 10 s (attempt ${i}/10)"
    sleep 10
done

echo "==> [4/6] Copying files to VM..."
# Recreate the same relative-path structure used in docker-compose.yml:
#   ~/licenta/docker/docker-compose.yml
#   ~/licenta/src/.env      (env_file: ../src/.env resolves correctly)
gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" \
    --command="mkdir -p ~/licenta/docker ~/licenta/src" --quiet

gcloud compute scp "Server/docker/docker-compose.yml" \
    "${INSTANCE}:~/licenta/docker/docker-compose.yml" \
    --zone="${ZONE}" --project="${PROJECT}"

gcloud compute scp "Server/docker/setup_vm.sh" \
    "${INSTANCE}:~/setup_vm.sh" \
    --zone="${ZONE}" --project="${PROJECT}"

# .env must already exist (copied from Server/src/.env.example and filled in)
if [[ ! -f "Server/src/.env" ]]; then
    echo "ERROR: Server/src/.env not found. Copy .env.example and fill in the values." >&2
    exit 1
fi
gcloud compute scp "Server/src/.env" \
    "${INSTANCE}:~/licenta/src/.env" \
    --zone="${ZONE}" --project="${PROJECT}"

echo "==> [5/6] Running setup script on the VM..."
gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" \
    --command="chmod +x ~/setup_vm.sh && ~/setup_vm.sh"

echo ""
echo "==> [6/6] Done!"
EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE}" \
    --zone="${ZONE}" --project="${PROJECT}" \
    --format="get(networkInterfaces[0].accessConfigs[0].natIP)")
echo ""
echo "  VM external IP : ${EXTERNAL_IP}"
echo "  Server API     : http://${EXTERNAL_IP}:${SERVER_PORT}"
echo ""
echo "  To SSH into the VM:"
echo "    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT}"
echo ""
echo "  To view logs:"
echo "    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT} \\"
echo "      --command='cd ~/licenta/docker && sudo docker compose logs -f'"
