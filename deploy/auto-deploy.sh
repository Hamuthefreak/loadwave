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

# Non-interactive SSH shells (GitHub Actions) don't source ~/.bashrc, so
# node/npm may be missing from PATH. Explicitly locate them if needed.
if ! command -v node >/dev/null 2>&1; then
  for base in "$HOME/.nvm/versions/node" "/usr/local" "/usr"; do
    if [ -x "$base/bin/node" ]; then
      export PATH="$base/bin:$PATH"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found — install Node 20 first (see DEPLOY_ORACLE.md)." >&2
  exit 1
fi

echo "==> [auto-deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) — node $(node -v)"
cd "$APP_DIR"

echo "==> Pulling latest code"
git fetch origin
git checkout --force main
git pull --ff-only origin main

echo "==> Backend install + build"
npm ci --include=dev
npx prisma generate
npm run build

echo "==> Frontend install + build"
cd "$APP_DIR/web"
npm ci --include=dev
npm run build
cd "$APP_DIR"

echo "==> Migrations"
npm run prisma:migrate:deploy

# PostGIS backs IFTA distance-by-jurisdiction from GPS route segments. It is
# an OPTIONAL enhancement: the app runs without it, so a server that lacks the
# extension must not fail the whole deploy (that is what kept production
# frozen — the deploy aborted here, before the service restart).
echo "==> Enabling PostGIS (idempotent, optional)"
if npm run db:postgis; then
  echo "    PostGIS ready"
else
  echo "WARN: PostGIS is not installed on this server."
  echo "      IFTA distance-by-jurisdiction from GPS route segments stays disabled."
  echo "      To enable it (as a user allowed to install packages):"
  echo "        apt-get install -y postgresql-16-postgis-3 && systemctl restart postgresql"
  echo "      then re-run this deploy."
fi

echo "==> Seeding geo places (idempotent)"
npm run db:seed-places

echo "==> Restarting service"
sudo systemctl restart loadboard

echo "==> [auto-deploy] done — https://health via systemctl status loadboard"
systemctl --no-pager status loadboard | head -12 || true
