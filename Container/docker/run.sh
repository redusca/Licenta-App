#!/usr/bin/env bash
# =============================================================================
#  Licenta Container -- run script (Linux / macOS)
# =============================================================================
#
#  EDIT THE PORT HERE TO CHANGE THE HOST PORT
PORT=8001
#
#  Everything below this line runs automatically -- no edits needed.
# =============================================================================

set -euo pipefail

IMAGE_FILE="licenta-container.tar"
IMAGE_NAME="licenta-container:latest"
CONTAINER_NAME="licenta-agent"
INTERNAL_PORT=8001

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAR_PATH="$SCRIPT_DIR/$IMAGE_FILE"

if [ ! -f "$TAR_PATH" ]; then
    echo "[ERROR] Image archive not found: $TAR_PATH"
    echo "        Make sure $IMAGE_FILE is in the same directory as this script."
    exit 1
fi

echo ">>> Loading Docker image from $IMAGE_FILE ..."
docker load -i "$TAR_PATH"

# Copy .env.example to .env if .env does not exist yet
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/.env.example" ]; then
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        echo ">>> Created .env from .env.example -- please edit it and set your GOOGLE_API_KEY."
        echo "    Then run this script again."
        exit 0
    else
        echo "[ERROR] No .env file found. Create one with at least GOOGLE_API_KEY and CONTAINER_API_KEY."
        exit 1
    fi
fi

# Stop and remove any previously running instance
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo ">>> Stopping existing container '$CONTAINER_NAME' ..."
    docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo ">>> Starting container '$CONTAINER_NAME' on host port $PORT ..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:$INTERNAL_PORT" \
    --restart unless-stopped \
    --env-file "$SCRIPT_DIR/.env" \
    "$IMAGE_NAME"

echo ""
echo "Container started successfully."
echo "  Access it at: http://localhost:$PORT"
echo ""
echo "  To stop it:   docker stop $CONTAINER_NAME"
echo "  To remove it: docker rm   $CONTAINER_NAME"