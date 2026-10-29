#!/usr/bin/env bash
#
# One-time install of the trading bot (freqtrade, DRY RUN) on the LoadWave VM.
#
# Run ON the server, as the deploy user:
#   bash /opt/loadboard/trading/deploy/install-freqtrade.sh
#
# Safe to re-run: it keeps an existing live config (and its generated web
# credentials) untouched.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # .../trading
APP_DIR="/opt/freqtrade"
LIVE_CONFIG="$APP_DIR/user_data/config.json"

echo "==> freqtrade installer (dry run)"

AVAIL_MB="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)"
echo "    available RAM: ${AVAIL_MB} MB"
if [ "${AVAIL_MB}" -lt 900 ]; then
  echo "WARN: under ~900 MB free. freqtrade loads pandas/numpy per pair and can"
  echo "      be killed by the OOM reaper next to LoadWave + PostgreSQL."
  echo "      Use the Ampere A1 shape (or a separate box) if this is a 1 GB VM."
fi

if ! command -v docker >/dev/null 2>&1; then
  cat <<'MSG'
Docker is not installed on this VM. Run these once, then re-run this script:

  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"    # then log out and back in

MSG
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: the 'docker compose' plugin is missing (package docker-compose-v2)." >&2
  exit 1
fi

# Prefer docker without sudo; fall back to non-interactive sudo when the CI user
# has no docker group membership.
DC="docker"
if ! docker info >/dev/null 2>&1; then
  DC="sudo -n docker"
  if ! $DC info >/dev/null 2>&1; then
    echo "ERROR: no permission to talk to the docker daemon." >&2
    echo "       Add the deploy user to the docker group: sudo usermod -aG docker \$USER" >&2
    exit 1
  fi
fi

echo "==> Preparing $APP_DIR"
mkdir -p "$APP_DIR/user_data/logs" "$APP_DIR/user_data/data" "$APP_DIR/user_data/strategies"
install -m 0644 "$SRC_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
if [ -d "$SRC_DIR/user_data/strategies" ]; then
  cp -n "$SRC_DIR"/user_data/strategies/* "$APP_DIR/user_data/strategies/" 2>/dev/null || true
fi

if [ ! -f "$LIVE_CONFIG" ]; then
  echo "==> Seeding config and generating web-UI credentials"
  install -m 0600 "$SRC_DIR/user_data/config.json" "$LIVE_CONFIG"
  python3 - "$LIVE_CONFIG" <<'PY'
import json, secrets, sys

path = sys.argv[1]
with open(path) as fh:
    cfg = json.load(fh)

api = cfg["api_server"]
api["jwt_secret_key"] = secrets.token_hex(32)
api["ws_token"] = secrets.token_urlsafe(24)
api["password"] = secrets.token_urlsafe(12)

with open(path, "w") as fh:
    json.dump(cfg, fh, indent=4)
    fh.write("\n")

print("    web UI login  ->  user: %s   password: %s" % (api["username"], api["password"]))
print("    (also stored in %s — change it there any time)" % path)
PY
else
  echo "==> Keeping existing live config: $LIVE_CONFIG"
fi

echo "==> Pulling the image (a few hundred MB on first run)"
cd "$APP_DIR"
$DC compose pull

echo "==> Starting the bot"
$DC compose up -d

echo "==> Waiting for the API to answer on 127.0.0.1:8080 (up to ~2 min)"
healthy=""
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8080/api/v1/ping >/dev/null 2>&1; then
    healthy="yes"
    break
  fi
  sleep 3
done

if [ -z "$healthy" ]; then
  echo "WARN: the API did not answer yet. Last log lines:" >&2
  $DC compose logs --tail 30 || true
  exit 1
fi

echo ""
echo "OK — the bot is running in DRY RUN (fake money, live prices)."
echo "View the UI from your laptop (never expose port 8080 publicly):"
echo ""
echo "  ssh -N -L 8080:127.0.0.1:8080 <user>@<vm-ip>"
echo "  then open http://127.0.0.1:8080"
echo ""
echo "Logs:    cd $APP_DIR && $DC compose logs -f"
echo "Restart: cd $APP_DIR && $DC compose restart"
echo "Stop:    cd $APP_DIR && $DC compose down"
