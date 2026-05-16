# Build both Docker images locally (on the laptop) and push them to GitHub
# Container Registry. The deploy server then just pulls these prebuilt images,
# saving 1-3 hours of build time on its 1 GB VPS.
#
# Usage (from project root):
#   .\scripts\build-and-push.ps1            # tag "latest"
#   .\scripts\build-and-push.ps1 v0.4.2     # custom tag (good for rollbacks)
#
# Prerequisites:
#   1. Docker Desktop running.
#   2. GitHub PAT with `write:packages` scope:
#      https://github.com/settings/tokens (Classic).
#   3. One-time login:
#      echo "ghp_XXXX" | docker login ghcr.io -u Delnart --password-stdin

param(
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

# Always run from project root regardless of where the script is invoked.
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# GHCR namespaces are forced lowercase — `Delnart` becomes `delnart`.
$Owner = "delnart"
$BackendImage  = "ghcr.io/${Owner}/fice-backend:${Tag}"
$FrontendImage = "ghcr.io/${Owner}/fice-frontend:${Tag}"

# Public API base baked into the frontend bundle at build time.
# If you ever move the API to a different host, change this here and rebuild.
$ApiBase = "https://api.ficebot.dev"

Write-Host "🔨 Building backend image: $BackendImage" -ForegroundColor Cyan
docker build `
    -t $BackendImage `
    -f docker/backend.Dockerfile `
    .
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }

Write-Host "🔨 Building frontend image: $FrontendImage" -ForegroundColor Cyan
docker build `
    --build-arg NEXT_PUBLIC_API_BASE=$ApiBase `
    -t $FrontendImage `
    -f docker/frontend.Dockerfile `
    .
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

Write-Host "🚀 Pushing images to ghcr.io..." -ForegroundColor Cyan
docker push $BackendImage
if ($LASTEXITCODE -ne 0) { throw "backend push failed — did you 'docker login ghcr.io'?" }
docker push $FrontendImage
if ($LASTEXITCODE -ne 0) { throw "frontend push failed" }

# Also tag as `latest` when pushing a versioned tag, so the prod compose
# (which references :latest) always picks up the newest stable build.
if ($Tag -ne "latest") {
    Write-Host "🔗 Also tagging $Tag as latest..." -ForegroundColor Cyan
    docker tag $BackendImage  "ghcr.io/${Owner}/fice-backend:latest"
    docker tag $FrontendImage "ghcr.io/${Owner}/fice-frontend:latest"
    docker push "ghcr.io/${Owner}/fice-backend:latest"
    docker push "ghcr.io/${Owner}/fice-frontend:latest"
}

Write-Host ""
Write-Host "✅ Push complete." -ForegroundColor Green
Write-Host "   On the server:" -ForegroundColor Yellow
Write-Host "     docker compose -f docker/docker-compose.prod.yml --env-file .env pull"
Write-Host "     docker compose -f docker/docker-compose.prod.yml --env-file .env up -d"
