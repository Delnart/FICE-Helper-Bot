#!/usr/bin/env bash
# Same as build-and-push.ps1, for bash environments (Git Bash, WSL, mac, Linux).
# Usage: ./scripts/build-and-push.sh [tag]
set -euo pipefail

cd "$(dirname "$0")/.."

OWNER="delnart"                                          # GHCR is case-sensitive lowercase
TAG="${1:-latest}"
BACKEND_IMAGE="ghcr.io/${OWNER}/fice-backend:${TAG}"
FRONTEND_IMAGE="ghcr.io/${OWNER}/fice-frontend:${TAG}"
API_BASE="https://api.ficebot.dev"

echo "🔨 Building backend image: ${BACKEND_IMAGE}"
docker build \
    -t "${BACKEND_IMAGE}" \
    -f docker/backend.Dockerfile \
    .

echo "🔨 Building frontend image: ${FRONTEND_IMAGE}"
docker build \
    --build-arg "NEXT_PUBLIC_API_BASE=${API_BASE}" \
    -t "${FRONTEND_IMAGE}" \
    -f docker/frontend.Dockerfile \
    .

echo "🚀 Pushing images to ghcr.io..."
docker push "${BACKEND_IMAGE}"
docker push "${FRONTEND_IMAGE}"

# Mirror versioned tag onto :latest so the prod compose (which references
# :latest) automatically picks up the newest stable build.
if [[ "${TAG}" != "latest" ]]; then
    echo "🔗 Also tagging ${TAG} as latest..."
    docker tag  "${BACKEND_IMAGE}"  "ghcr.io/${OWNER}/fice-backend:latest"
    docker tag  "${FRONTEND_IMAGE}" "ghcr.io/${OWNER}/fice-frontend:latest"
    docker push "ghcr.io/${OWNER}/fice-backend:latest"
    docker push "ghcr.io/${OWNER}/fice-frontend:latest"
fi

echo ""
echo "✅ Push complete."
echo "   On the server:"
echo "     docker compose -f docker/docker-compose.prod.yml --env-file .env pull"
echo "     docker compose -f docker/docker-compose.prod.yml --env-file .env up -d"
