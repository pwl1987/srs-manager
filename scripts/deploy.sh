#!/bin/bash
# SRS Manager Deployment Script
# Run this on the SRS server

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"

echo "=== SRS Manager Deployment ==="

# 1. Create data directory
mkdir -p "$DATA_DIR"

# 2. Generate admin password hash if not exists
if [ -z "${ADMIN_PASSWORD_HASH}" ]; then
  echo "Generating admin password hash..."
  ADMIN_PASSWORD_HASH=$(node -e "const b=require('bcryptjs');b.hash('admin123',10).then(h=>console.log(h))")
  echo "Admin password: admin123 (change this!)"
  echo "ADMIN_PASSWORD_HASH=$ADMIN_PASSWORD_HASH" >> "$PROJECT_DIR/.env"
fi

# 3. Generate JWT secret if not exists
if [ -z "${JWT_SECRET}" ]; then
  echo "Generating JWT secret..."
  JWT_SECRET=$(openssl rand -hex 64)
  echo "JWT_SECRET=$JWT_SECRET" >> "$PROJECT_DIR/.env"
fi

# 4. Create .env if not exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  echo "Created .env from .env.example"
fi

# 5. Build Docker image
echo "Building Docker image..."
docker build -t srs-manager:latest "$PROJECT_DIR"

# 6. Stop existing container
docker stop srs-manager 2>/dev/null || true
docker rm srs-manager 2>/dev/null || true

# 7. Start container
echo "Starting container..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d

# 8. Wait for health check
echo "Waiting for health check..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/health | grep -q '"status":"ok"'; then
    echo "SRS Manager is running at http://localhost:3001"
    exit 0
  fi
  sleep 2
done

echo "SRS Manager failed to start. Check logs:"
docker logs srs-manager
exit 1
