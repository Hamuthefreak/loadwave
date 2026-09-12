#!/usr/bin/env bash
#
# Loadboard — install PostGIS on the production VM.
#
# Why: PostGIS powers the RouteSegment geometry, which is what turns GPS points
# into per-jurisdiction distances for IFTA. Without it the app still runs (ELD
# ingest and IFTA degrade to fuel-only figures), but distance by jurisdiction
# from GPS stays blank.
#
# This needs root on the server. Run it ON the VM as a user allowed to install
# packages, e.g.:
#
#   bash /opt/loadboard/deploy/install-postgis.sh
#
# Afterwards, re-run the deploy (or `npm run db:postgis`) so the extension is
# created in the database and the geometry column + boundary table exist.
set -euo pipefail

PG_MAJOR="${PG_MAJOR:-16}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root (or via the VM's package privileges)." >&2
  exit 1
fi

echo "==> Detecting package family"
if command -v apt-get >/dev/null 2>&1; then
  echo "==> Installing postgresql-${PG_MAJOR}-postgis-3"
  apt-get update -y
  apt-get install -y "postgresql-${PG_MAJOR}-postgis-3"
elif command -v dnf >/dev/null 2>&1; then
  echo "==> Installing postgis on an RPM-based host"
  dnf install -y "postgis${PG_MAJOR//./}" postgis
else
  echo "Unsupported package manager — install PostGIS for PostgreSQL ${PG_MAJOR} manually." >&2
  exit 1
fi

echo "==> Restarting PostgreSQL"
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart postgresql
fi

echo "==> Extensions available:"
su - postgres -c "psql -tAc \"SELECT name FROM pg_available_extensions WHERE name = 'postgis'\"" || true

echo
echo "PostGIS installed. Next: create it in the Loadboard database and add the"
echo "geometry column, then restart the app — from the app directory run:"
echo "  npm run db:postgis"
echo "  bash deploy/auto-deploy.sh"
