#!/usr/bin/env bash
#
# Loadboard — Oracle Cloud Always Free one-time server setup
#
# Run on the Ubuntu instance as the `ubuntu` user:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Hamuthefreak/loadwave/main/deploy/setup-server.sh)
#   (or: upload deploy/setup-server.sh to the VM and run `bash setup-server.sh`)
#
# Requires:
#   - Ubuntu 22.04/24.04 instance (Oracle Cloud free-tier)
#   - SSH access already working (you have the public IPv4)
#   - Your FreeDNS subdomain (edit DOMAIN below)

set -euo pipefail

# =============================================================
# CONFIG — EDIT THESE
# =============================================================
DOMAIN="loadwave.mooo.com"      # <-- your FreeDNS subdomain
# Use the SSH form so the VM can pull the PRIVATE repo with its deploy key.
REPO_URL="git@github.com:Hamuthefreak/loadwave.git"
BRANCH="main"
APP_DIR="/opt/loadboard"
UBUNTU_USER="ubuntu"                # user that owns the app

# =============================================================
# 0. GitHub deploy key (lets the VM clone/pull your PRIVATE repo)
# =============================================================
echo "==> Preparing GitHub deploy key"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
DEPLOY_KEY="$HOME/.ssh/loadboard_deploy"
if [ ! -f "$DEPLOY_KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "loadboard-deploy-$HOSTNAME" -f "$DEPLOY_KEY" >/dev/null
fi
cat > "$HOME/.ssh/config" <<'SSH_CFG'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/loadboard_deploy
  IdentitiesOnly yes
SSH_CFG
chmod 600 "$HOME/.ssh/config"

echo ""
echo "----------------------------------------------------------------------------------"
echo " EXIT BLOCK: if git clone below says 'Permission denied (publickey)', you must"
echo " add this PUBLIC key on GitHub first:"
echo "   GitHub -> repo -> Settings -> Deploy keys -> Add deploy key (read-only)"
echo "   Key content (copy the whole line below):"
echo ""
cat "$DEPLOY_KEY.pub"
echo ""
echo " Then re-run this script."
echo "----------------------------------------------------------------------------------"
echo ""

# Quick auth test so the user isn't hit with a confusing error later.
if ! ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -T git@github.com >/dev/null 2>&1; then
  echo "WARNING: cannot reach GitHub over SSH as $USER yet."
  echo "If the key above still needs adding, add it now (Ctrl+C, re-run after)."
fi

# =============================================================
# 1. System packages
# =============================================================
echo "==> Updating system packages"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Installing nginx, curl, git"
sudo apt-get install -y nginx curl ca-certificates git

echo "==> Setting up Node.js 20 (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing PostgreSQL"
sudo apt-get install -y postgresql postgresql-contrib

echo "==> Verifying Node / npm"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: node or npm still not on PATH after install." >&2
  echo "This usually means setup_20.x failed or you're on a non-Ubuntu distro." >&2
  echo "Fix manually, then re-run the script:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi
echo "==> Node version: $(node -v)  npm: $(npm -v)"

# =============================================================
# 2. Prepare the app directory owned by the app user
# =============================================================
echo "==> Creating $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$UBUNTU_USER":"$UBUNTU_USER" "$APP_DIR"

# =============================================================
# 3. Clone the repo
# =============================================================
if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> Cloning $REPO_URL"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "==> Repo already present, pulling latest"
  git -C "$APP_DIR" pull --ff-only
fi

# =============================================================
# 4. Database setup (idempotent — safe to re-run)
# =============================================================
echo "==> Creating PostgreSQL role + database (skips if they exist)"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'loadboard') THEN
    CREATE ROLE loadboard LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -lqt | grep -qw "loadboard" || sudo -u postgres createdb --owner=loadboard loadboard

# =============================================================
# 5. Build the app
# =============================================================
echo "==> Installing + building backend ($APP_DIR)"
cd "$APP_DIR"
npm ci
npx prisma generate
npm run build

echo "==> Installing + building frontend ($APP_DIR/web)"
cd "$APP_DIR/web"
npm ci
npm run build

# =============================================================
# 6. .env
# =============================================================
JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
PORT=4000
LOG_LEVEL=info
DATABASE_URL=postgresql://loadboard:$DB_PASSWORD@localhost:5432/loadboard?schema=public
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_ACCESS_TTL=900
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_REFRESH_TTL=604800
JWT_ISSUER=loadboard
JWT_AUDIENCE=loadboard-clients
ELD_WEBHOOK_SECRET=$(openssl rand -hex 16)
IFTA_JURISDICTION_RATES=
SMTP_URL=
MAIL_FROM=dispatch@$DOMAIN
ENV
sudo chown "$UBUNTU_USER":"$UBUNTU_USER" "$APP_DIR/.env"
echo "==> .env written (secrets generated automatically)"

# =============================================================
# 7. Migrate + seed
# =============================================================
echo "==> Running database migrations"
cd "$APP_DIR"
npm run prisma:migrate:deploy

echo "==> Seeding geo places (radius search) + demo data"
npm run db:seed-places
# Demo tenant credentials are printed to stdout by the seeder — save them:
npm run db:seed-demo | tee "$APP_DIR/demo-credentials.txt"

# =============================================================
# 8. Install the systemd service
# =============================================================
echo "==> Installing systemd service"
sed "s/^User=ubuntu/User=$UBUNTU_USER/" deploy/loadboard.service > /tmp/loadboard.service
sudo cp /tmp/loadboard.service /etc/systemd/system/loadboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now loadboard

# =============================================================
# 9. Nginx
# =============================================================
echo "==> Configuring nginx"
sed "s/loadboard.example.com/$DOMAIN/g" deploy/nginx-loadboard.conf > /tmp/loadboard-nginx
sudo cp /tmp/loadboard-nginx /etc/nginx/sites-available/loadboard
sudo ln -sf /etc/nginx/sites-available/loadboard /etc/nginx/sites-enabled/loadboard
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> Opening firewall ports 80 (and 22 is already open)"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 80/tcp || true
  sudo ufw allow 22/tcp || true
  sudo ufw --force enable || true
fi

echo ""
echo "=============================================================="
echo " DONE. Your app should be live at http://$DOMAIN"
echo ""
cat "$APP_DIR/demo-credentials.txt" || true
echo ""
echo " Next steps:"
echo "   1. In Oracle Cloud Console: Networking > VCN > Security List"
echo "      add an INGRESS rule for TCP 80 (and 443 later) source 0.0.0.0/0"
echo "   2. On FreeDNS, make sure your subdomain's A record -> your VM public IP"
echo "   3. For HTTPS: see DEPLOY_ORACLE.md (certbot step)"
echo "   4. For auto-deploy on git push: see DEPLOY_ORACLE.md (GitHub Actions)"
echo "=============================================================="
