#!/usr/bin/env bash
#
# Loadboard — auto-deploy script (runs ON the server, triggered by GitHub Actions
# on push to main, or manually).
#
#   bash /opt/loadboard/deploy/auto-deploy.sh
#
set -euo pipefail

APP_DIR="/opt/loadboard"
export NODE_ENV=production

echo "==> [auto-deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
cd "$APP_DIR"

echo "==> Pulling latest code"
git fetch origin
git checkout --force main
git pull --ff-only origin main

echo "==> Backend install + build"
npm ci
npx prisma generate
npm run build

echo "==> Frontend install + build"
cd "$APP_DIR/web"
npm ci
npm run build
cd "$APP_DIR"

echo "==> Migrations"
npm run prisma:migrate:deploy

echo "==> Seeding geo places (idempotent)"
npm run db:seed-places

echo "==> Restarting service"
sudo systemctl restart loadboard

echo "==> [auto-deploy] done — https://health via systemctl status loadboard"
systemctl --no-pager status loadboard | head -12 || true