# Deploy Loadboard to Oracle Cloud Always Free (100% free §)

Step-by-step guide to get the site live at your FreeDNS subdomain **and** wired to
GitHub so every push to `main` auto-deploys.

> If you signed up for the **Always Free** tier you have unlimited-time resources
> (2 AMD VMs + 4 Arm OCPUs / 24 GB RAM / 200 GB storage for free). Everything below
> stays inside Always Free.

---

## 0. What you have / what you need

| Thing | Where it lives |
|---|---|
| Oracle account + one Ubuntu VM (Instance) | Oracle Cloud Console |
| Public IPv4 of that VM | Instance details page |
| FreeDNS subdomain (e.g. `loadboard.freedns.example`) | FreeDNS panel |
| GitHub repo `Hamuthefreak/loadwave` (private) | github.com |
| New Loadboard code (committed locally as `1002ca5`) | `E:\1 OPENCODE DIR\loadwave` |

---

## 1. Push the NEW code to GitHub (important — your repo is outdated!)

Your GitHub repo currently contains the **old** Loadboard build (14+ commits). The new
full-stack rewrite is committed locally but **not pushed yet**, and it has no shared history
with the old repo, so you need a force-push to replace `main`.

In `E:\1 OPENCODE DIR\loadwave` (PowerShell):

```powershell
git remote add origin https://github.com/Hamuthefreak/loadwave.git
git push --force origin main
```

> `--force` replaces the old history with the new single commit. That's intended here —
> the old code is superseded. Confirm the repo now shows `1002ca5 Loadboard: ...` at top.

**Why this matters:** the server and the GitHub Action below both pull from this repo.
If you skip this, the site would deploy the old design.

---

## 2. Prepare GitHub Secrets (for auto-deploy)

Auto-deploy works like this:

```
push code to main  →  GitHub Actions runs  →  SSH into your VM  →  pull + build + restart
```

GitHub needs 3 secrets so it can reach your VM. In your repo:
**Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `VM_HOST` | your VM public IPv4 (e.g. `152.xx.xx.xx`) |
| `VM_USER` | `ubuntu` (the default Oracle Ubuntu user) |
| `VM_SSH_KEY` | the **private** key of the pair you generate in step 6 |

`deploy/.github/workflows/deploy.yml` is already in the repo and reads these secrets.

---

## 3. Get onto the VM (SSH)

From your computer (PowerShell), you can always connect:

```powershell
ssh ubuntu@<YOUR_PUBLIC_IP>
```

If you don't have a keypair yet, create one on your PC and copy it to the VM:

```powershell
ssh-keygen -t ed25519 -C "loadboard-deploy" -f $HOME\.ssh\loadboard
# (accept defaults / enter a passphrase — a passphrase is fine for your PC)
Get-Content $HOME\.ssh\loadboard.pub
```

Then in Oracle Cloud Console open your **Instance → Resources → Console connection → SSH keys**,
or use the console's `key addition` (OCI web console → "Create console connection" isn't the
same — the usual path is: **Instance → Resources → Attached VNICs → Security lists**, but the
*authorized key* lives on the machine image). The simplest reliable way:

- In the OCI web console: **Instance → Start** (if stopped) → **Console → Cloud Shell** is not
  attached by default. Instead: **Instance → Create** menu includes "Add SSH keys" only at launch.
  Because your VM is already launched, add your key inside the VM using the **OCI web console
  command in the Instance page**: click the three-dot menu → **Open local shell** isn't a thing.

**Cleanest path** (works every time): use the OCI Console **serial console / cloud shell** if
enabled. Otherwise, if you created the instance **with** an SSH key, you already have the
matching private key — skip ahead. If you're unsure you have the private key, the safest route
is to **terminate nothing** — instead create a NEW instance with your key via
`ssh-keygen` above and attach your block volume later. To keep this guide simple, I assume
you **already have the SSH key the instance was created with** (you have the public IP, which
means the instance is up, which usually means you launched it with a key). Connect:

```powershell
ssh -i $HOME\.ssh\loadboard ubuntu@<YOUR_PUBLIC_IP>
```

> Not sure which key? Check `~/.ssh/*.pub` on this PC, or the Oracle "Bastion/Console"
> docs. The important thing is: **you can run commands on the VM before continuing.**

---

## 4. Install everything with one script

Once you're `ubuntu@...` on the VM, run the one-shot setup. Two ways to get the script there:

**Option A — copy from this PC (simplest):** on your PC run

```powershell
scp -i $HOME\.ssh\loadboard deploy\setup-server.sh deploy\loadboard.service deploy\nginx-loadboard.conf ubuntu@<IP>:/tmp/
```

then on the VM:

```bash
sudo chmod +x /tmp/setup-server.sh
# Edit the DOMAIN + repo defaults first:
#   sudo nano /tmp/setup-server.sh   → set DOMAIN="your-subdomain.your-domain"
sudo bash /tmp/setup-server.sh
```

**Option B — after you've pushed (step 1)**, the script is already in the repo, so on the VM:

```bash
curl -fsSL https://raw.githubusercontent.com/Hamuthefreak/loadwave/main/deploy/setup-server.sh -o /tmp/setup-server.sh
sudo bash /tmp/setup-server.sh
```

**Before running, edit two lines** at the top of the script (use `nano`):

```bash
DOMAIN="your-subdomain.your-domain"     # ← your FreeDNS subdomain
# keep REPO_URL, BRANCH, APP_DIR as-is
```

> The script does ALL of this automatically: installs Node 20 + PostgreSQL + nginx,
> clones the repo to `/opt/loadboard`, builds backend + frontend, creates a new
> postgres DB + app user with random passwords, writes `/opt/loadboard/.env`,
> runs migrations, seeds demo data, installs the `loadboard` systemd service,
> configures nginx, and prints your **demo login credentials** at the end.

When it finishes you'll see a line like:

```
Demo tenant seeded:  …  Admin: demo123456@loadboard.app  …  Password: DemoPass123!
```

**Save those credentials** — that's the login for your new site.

---

## 5. Open the firewall (both places)

Two firewalls are in play:

**(1) OCI Security List (the one that most often blocks things):**
Oracle Cloud Console → **Networking → Virtual cloud networks → Default Security List →
Add Ingress Rules**: add rules for **TCP 80** and **TCP 443**, source `0.0.0.0/0`.

**(2) VM firewall (UFW):** the setup script already ran
`ufw allow 80 && ufw allow 22`. If you skipped it:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 6. Point your FreeDNS subdomain at the VM

In FreeDNS, edit your subdomain's record:

- Type: **A**
- Value: your **VM public IPv4** (same as `VM_HOST`)

DNS can take a few minutes to propagate. Verify from your PC:

```powershell
Resolve-DnsName your-subdomain.your-domain
nslookup your-subdomain.your-domain
```

It should return your VM's IPv4.

---

## 7. Check the site is live

From your browser open: `http://your-subdomain.your-domain`

You should see the Loadboard homepage. Log in with the **demo credentials** printed by the
setup script. Try:
- Dashboard (revenue, miles, fuel)
- Search Loads / Search Trucks (seeded content visible)
- My Loads → post + publish a load
- Tools (market conditions + lane trends)
- Settings (SMTP form — leave host empty; in-app alerts still work)

If the page doesn't load, debug in order: DNS (step 6) → OCI security list (step 5) →
service status:

```bash
systemctl status loadboard           # should say active (running)
sudo nginx -t                        # nginx config valid
journalctl -u loadboard -n 50        # backend logs
```

---

## 8. HTTPS (free with Let's Encrypt) — recommended

Once HTTP works and your subdomain resolves, add a free TLS cert in 2 commands (on the VM):

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-subdomain.your-domain --register-unsafely-without-email
```

Certbot auto-renews (it installs a systemd timer). Then users get `https://` automatically.
You can also set the nginx `server_name` to your subdomain after cert issuance to get a
permanent redirect to HTTPS.

> FreeDNS subdomains work fine with Let's Encrypt via the HTTP-01 challenge as long as the
> A record points at your VM (it does by step 6).

---

## 9. Auto-deploy on every GitHub push

Everything is already in place; you just need to add the VM's public key so GitHub Actions
can SSH in, and create `VM_SSH_KEY`.

**On the VM, generate a key for GitHub Actions:**

```bash
ssh-keygen -t ed25519 -C "github-actions" -f /home/ubuntu/.ssh/gh_actions -N ""
cat /home/ubuntu/.ssh/gh_actions.pub   # copy this line
echo "publickey github-actions@vm" >> /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

**On GitHub:**
1. **Settings → Secrets and variables → Actions** → add `VM_HOST` (VM IPv4), `VM_USER`
   (`ubuntu`), and `VM_SSH_KEY` (the **private** line of the same key — the
   `gh_actions` file, not `.pub` — paste its full content).
2. The workflow file `.github/workflows/deploy.yml` is already in the repo (I added it), so
   **no code change needed**.

**Test it:** make a tiny commit to `main` (any file) and push:

```powershell
git add -A
git commit -m "test auto-deploy"
git push origin main
```

Open **GitHub → Actions** → you'll see "Auto-deploy to Oracle VM" run. When the green check
appears, the site has been rebuilt from your new code. The script
(`deploy/auto-deploy.sh`) does: pull → install → build backend + frontend → migrate →
seed places → restart `loadboard` service.

> The VM must be reachable from GitHub Actions. Oracle's default ingress already allows SSH
> from anywhere; if your Security List restricts port 22 to your own IP, add
> `github.com`'s/`0.0.0.0/0` for 22 so the runner can connect (or narrow to GitHub's published
> [runner ranges](https://api.github.com/meta) — `0.0.0.0/0` is simplest for a hobby project).

---

## 10. Day-2 operations

| Task | Command (on VM) |
|---|---|
| View logs | `journalctl -u loadboard -f` |
| Restart manually | `sudo systemctl restart loadboard` |
| Manually redeploy | `bash /opt/loadboard/deploy/auto-deploy.sh` |
| See demo login | `cat /opt/loadboard/demo-credentials.txt` |
| DB CLI | `sudo -u postgres psql loadboard` |
| Enabled services | `systemctl list-units --type=service --state=running \| grep -E 'loadboard\|nginx\|postgres'` |

### SMTP / email alerts (optional, add the key later)
The in-app notification feed works with no setup. To enable real emails, put your SMTP
credentials either in `/opt/loadboard/.env` (SMTP_URL / MAIL_FROM) or through the app's
**Settings → SMTP** form (stored per-tenant). Free Render deployments can't send SMTP, but
your Oracle VM can — outbound 587/465 are fine there.

---

## Troubleshooting quick reference

- **`502 Bad Gateway`** → backend not running: `systemctl status loadboard && journalctl -u loadboard -n 30`
- **White page / blank** → frontend build missing: `cd /opt/loadboard/web && npm run build`
- **Login fails** → check `DATABASE_URL` in `/opt/loadboard/.env` and `systemctl status postgresql`
- **"Request failed (401)"** after login → JWT secrets changed after restart; logs in again.
- **Subdomain loads on phone but not PC** → DNS cache: `ipconfig /flushdns` on Windows.
- **Deploy workflow fails "Permission denied"** → `VM_SSH_KEY` must be the private key; re-add
  it and check the VM's `authorized_keys` file for the matching public line.
- **Port 80 blocked** → OCI Security List ingress rule missing (step 5) or VM's own ufw.

---

## Files that make this possible (all in the repo)

- `.github/workflows/deploy.yml` — push → SSH → run auto-deploy
- `deploy/setup-server.sh` — one-shot VM provisioning
- `deploy/auto-deploy.sh` — rebuild + restart (used by the workflow)
- `deploy/loadboard.service` — systemd unit
- `deploy/nginx-loadboard.conf` — nginx: static SPA + `/api` + `/auth` proxy
- `scripts/seed-places.ts` — city/postal dataset for radius search
- `scripts/seed-demo.ts` — demo tenant, loads, trucks, drivers, assets
- `scripts/import-loads.ts` — import external board loads (CLI)

Everything above stays inside Oracle's Always Free limits. Good luck — ping me if any step
errors out and I'll walk you through the exact fix.