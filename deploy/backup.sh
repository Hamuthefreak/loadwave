#!/usr/bin/env bash
#
# Loadboard — nightly PostgreSQL backup.
#
#   bash /opt/loadboard/deploy/backup.sh
#
# Dumps the database (custom format) to /opt/loadboard/backups, keeps the last
# 14 dumps, and — if BACKUP_TARGET is set (an scp/rsync destination such as
# "user@backup-host:/srv/backups/loadboard") — copies the newest dump off-box.
#
# Install a nightly cron as root/ubuntu:
#   10 2 * * * /usr/bin/env bash /opt/loadboard/deploy/backup.sh >> /var/log/loadboard-backup.log 2>&1
#
set -euo pipefail

APP_DIR="/opt/loadboard"
BACKUP_DIR="$APP_DIR/backups"
KEEP_DAYS=14
BACKUP_TARGET="${BACKUP_TARGET:-}"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

# Source DATABASE_URL from the app env file without echoing secrets.
DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2-)"
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not found in $APP_DIR/.env" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/loadboard-$STAMP.dump"

echo "==> [backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) dumping to $FILE"
pg_dump --format=custom --no-owner "$DB_URL" > "$FILE"

echo "==> Pruning backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -name 'loadboard-*.dump' -mtime "+$KEEP_DAYS" -delete

if [ -n "$BACKUP_TARGET" ]; then
  echo "==> Copying newest dump off-box to $BACKUP_TARGET"
  NEWEST="$(ls -1t "$BACKUP_DIR"/loadboard-*.dump | head -1)"
  rsync -a --remove-source-files "$NEWEST" "$BACKUP_TARGET" 2>/dev/null \
    || scp -q "$NEWEST" "$BACKUP_TARGET"
fi

echo "==> [backup] done"
ls -1t "$BACKUP_DIR"/loadboard-*.dump | head -3