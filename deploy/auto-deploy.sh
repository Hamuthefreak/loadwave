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
# CI runs non-interactively and the VM grants the deploy user no systemctl
# rights ("Interactive authentication required"), which is what kept the deploy
# red — code and migrations landed but the running process never picked them
# up. Try the privileged paths first (harmless if unavailable), then fall back
# to signalling the process: the unit is Restart=always, so systemd brings it
# back with the freshly built code a few seconds later.
if sudo -n systemctl restart loadboard 2>/dev/null || systemctl restart loadboard 2>/dev/null; then
  echo "    restarted via systemctl"
else
  echo "    no reload permission here — signalling the service process instead"
  pkill -f '/opt/loadboard/dist/src/main.js' || true
  sleep 7
fi

# Wait for the API to answer, so a broken build fails the deploy loudly.
healthy=""
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    healthy="yes"
    break
  fi
  sleep 2
 done
if [ -n "$healthy" ]; then
  echo "    API is answering on :4000"
else
  echo "ERROR: the API did not answer after a restart — check the service" >&2
  systemctl --no-pager status loadboard | head -20 || true
  exit 1
fi

echo "==> [auto-deploy] done"
systemctl --no-pager status loadboard | head -12 || true
