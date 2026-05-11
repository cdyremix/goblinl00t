# Goblin L00t — AWS EC2 deploy runbook

Hot-swap the existing site at `/opt/goblinl00t/web` with the new app.
No Docker — uses your host's nginx + a systemd-managed Node service +
local Postgres. Designed for the layout you already have:

```
goblin@ip-172-26-7-141:/opt/goblinl00t      ← repo root (git clone here)
goblin@ip-172-26-7-141:/opt/goblinl00t/web  ← dashboard static files (nginx docroot)
```

## 0. Snapshot the existing site before you touch anything

```bash
sudo tar czf /opt/goblinl00t.web.bak.$(date +%F).tgz -C /opt/goblinl00t web
ls -lh /opt/goblinl00t.web.bak.*.tgz
# Note the path — this is your one-command rollback (see end).
```

If there's an existing service or nginx config for the old site, list it
so you can disable it cleanly later:

```bash
ls /etc/nginx/sites-enabled/
systemctl list-units --type=service --state=running | grep -iE 'goblin|node|pm2' || true
```

## 1. Install prerequisites (one-time)

```bash
# Node 24 (NodeSource — Ubuntu/Debian; for Amazon Linux 2023 swap in dnf)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs build-essential

# pnpm via corepack
sudo corepack enable
sudo corepack prepare pnpm@10 --activate

# Postgres 16
sudo apt-get install -y postgresql-16 postgresql-contrib

# nginx + certbot (skip nginx if already installed)
sudo apt-get install -y nginx certbot python3-certbot-nginx

# rsync (for the release script's atomic swap)
sudo apt-get install -y rsync
```

Verify:

```bash
node -v        # v24.x
pnpm -v        # 10.x
psql --version # 16.x
nginx -v
```

## 2. Create the Postgres database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER goblin WITH PASSWORD 'PUT_A_STRONG_PASSWORD_HERE';
CREATE DATABASE goblin OWNER goblin;
GRANT ALL PRIVILEGES ON DATABASE goblin TO goblin;
SQL
```

Test the connection string you'll put in `.env`:

```bash
psql "postgres://goblin:PUT_A_STRONG_PASSWORD_HERE@127.0.0.1:5432/goblin" -c '\l'
```

## 3. Clone the repo into /opt/goblinl00t

If `/opt/goblinl00t` is currently a plain directory (not a git repo) and
just contains a `web/` folder, set it up like this:

```bash
# Move the existing live web bundle aside so the new repo lives at the
# expected root. We restore it back in step 5 once the new build is ready.
sudo mv /opt/goblinl00t /opt/goblinl00t.OLD

sudo mkdir -p /opt/goblinl00t
sudo chown goblin:goblin /opt/goblinl00t

# Clone (replace with your fork URL — push the repo somewhere reachable
# from this box first, e.g. GitHub).
cd /opt
sudo -u goblin git clone https://github.com/<your-org>/goblinl00t.git goblinl00t
```

Pre-create the docroot the new release script will write into:

```bash
sudo mkdir -p /opt/goblinl00t/web /var/log/goblinl00t
sudo chown -R goblin:goblin /opt/goblinl00t/web /var/log/goblinl00t
```

## 4. Create the env file

```bash
sudo install -m 600 -o goblin -g goblin /dev/null /etc/goblinl00t.env
sudo -u goblin $EDITOR /etc/goblinl00t.env
```

Paste this and fill in real values. Same matrix as `deploy/.env.example`,
just collapsed into a flat env file (no `${VAR:-default}` shell syntax —
systemd reads it as plain `KEY=value`).

```ini
NODE_ENV=production
PORT=8080
LOG_LEVEL=info

# DB
DATABASE_URL=postgres://goblin:PUT_A_STRONG_PASSWORD_HERE@127.0.0.1:5432/goblin

# Public domain — drives Stripe webhook URL + OAuth callback hostname.
# Bare host, no scheme.
REPLIT_DOMAINS=goblinl00t.com
APP_BASE_URL=https://goblinl00t.com

# Clerk (production keys)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_REPLACE
CLERK_PUBLISHABLE_KEY=pk_live_REPLACE
CLERK_SECRET_KEY=sk_live_REPLACE

# Twitch
TWITCH_CLIENT_ID=REPLACE
TWITCH_CLIENT_SECRET=REPLACE
TWITCH_REDIRECT_URI=https://goblinl00t.com/api/auth/twitch/callback
TWITCH_BOT_USERNAME=goblinl00t
TWITCH_CHANNEL=goblinl00t
TWITCH_OAUTH_TOKEN=oauth:REPLACE   # leave unset to keep bot offline

# Sessions
SESSION_SECRET=$(openssl rand -hex 32)

# Admin allowlist (defaults to c.borawa@gmail.com if blank)
SUPER_USER_EMAILS=

# Stripe (live keys)
STRIPE_SECRET_KEY=sk_live_REPLACE
STRIPE_PUBLISHABLE_KEY=pk_live_REPLACE

# Maintenance kill-switch — leave empty for normal operation.
MAINTENANCE_MODE=

# Dev sign-in MUST stay disabled in production.
ENABLE_DEV_SIGN_IN=false
```

(Generate `SESSION_SECRET` with `openssl rand -hex 32` and paste the
literal value — the `$(...)` syntax is shell, not env-file.)

## 5. First build + bring up the service

```bash
cd /opt/goblinl00t
chmod +x deploy/aws-ec2/release.sh
sudo cp deploy/aws-ec2/goblin-l00t.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable goblin-l00t   # don't start yet — release.sh will

# Build, swap dashboard into /opt/goblinl00t/web, push DB schema, start service.
sudo -u goblin -H ./deploy/aws-ec2/release.sh
```

Confirm it's listening:

```bash
curl -s http://127.0.0.1:8080/api/healthz       # should return 200
sudo systemctl status goblin-l00t               # active (running)
ls /opt/goblinl00t/web                          # index.html + assets/
```

## 6. Wire up nginx (replace the old site)

If the existing live site has its own server block, disable it first:

```bash
sudo ls /etc/nginx/sites-enabled/
# Disable whichever one currently serves goblinl00t.com:
sudo rm /etc/nginx/sites-enabled/<old-site-name>
```

Drop in the new one:

```bash
sudo cp /opt/goblinl00t/deploy/aws-ec2/nginx-goblinl00t.conf \
        /etc/nginx/sites-available/goblinl00t.com
sudo ln -sf /etc/nginx/sites-available/goblinl00t.com \
            /etc/nginx/sites-enabled/goblinl00t.com
sudo nginx -t
sudo systemctl reload nginx
```

Smoke test from your laptop (still over HTTP at this point):

```bash
curl -I http://goblinl00t.com/
curl    http://goblinl00t.com/api/healthz
```

## 7. TLS via Let's Encrypt

```bash
sudo certbot --nginx -d goblinl00t.com -d www.goblinl00t.com
# Choose: redirect HTTP → HTTPS when prompted.
# Certbot rewrites the site config to add the 443 server block + redirect.
sudo systemctl reload nginx
```

After this, your final URLs are:

- Dashboard: `https://goblinl00t.com/`
- API: `https://goblinl00t.com/api/healthz`
- Stripe webhook (auto-registered): `https://goblinl00t.com/api/stripe/webhook`
- Twitch OAuth callback: `https://goblinl00t.com/api/auth/twitch/callback`

Make sure your **Twitch app** (dev.twitch.tv → your app → Manage) has
that callback URL whitelisted, or sign-in will fail with
`redirect_uri_mismatch`.

## 8. Post-deploy checks

```bash
# Service health
journalctl -u goblin-l00t -n 100 --no-pager
sudo systemctl status goblin-l00t

# Stripe webhook auto-registered?
journalctl -u goblin-l00t | grep -i stripe

# Bot online? (only if TWITCH_OAUTH_TOKEN was set)
journalctl -u goblin-l00t | grep -iE 'tmi|joined|connected'
```

Open `https://goblinl00t.com/`, sign in as your admin email, and:
- `/admin` should be reachable.
- `/admin` → Maintenance Mode → flip ON, then verify a non-admin sees
  the wall (incognito).
- Account → connect Twitch → Forge → settings round-trip.

## Day-2 ops

| Task                         | Command                                                           |
|------------------------------|-------------------------------------------------------------------|
| Tail logs                    | `journalctl -u goblin-l00t -f`                                    |
| Restart service              | `sudo systemctl restart goblin-l00t`                              |
| Deploy a new release         | `cd /opt/goblinl00t && git pull && sudo -u goblin -H ./deploy/aws-ec2/release.sh` |
| Manual DB schema sync        | `cd /opt/goblinl00t && pnpm --filter @workspace/db run push`      |
| psql shell                   | `sudo -u postgres psql goblin`                                    |
| Backup DB                    | `pg_dump -U goblin -h 127.0.0.1 goblin \| gzip > goblin-$(date +%F).sql.gz` |
| Reload nginx (after edits)   | `sudo nginx -t && sudo systemctl reload nginx`                    |
| Renew TLS                    | `sudo certbot renew --dry-run` (cron handles auto-renew)          |

## Rollback (if a release breaks prod)

```bash
# 1. Stop the new service
sudo systemctl stop goblin-l00t

# 2. Restore the old static bundle
sudo rm -rf /opt/goblinl00t/web
sudo mkdir /opt/goblinl00t/web
sudo tar xzf /opt/goblinl00t.web.bak.<DATE>.tgz -C /opt/goblinl00t

# 3. (Only if needed) check out the previous git ref
cd /opt/goblinl00t && git log --oneline -10
git checkout <previous-commit-sha>
sudo -u goblin -H ./deploy/aws-ec2/release.sh
```

## Common gotchas

- **`drizzle-kit push` warns "destructive change."** Run with `--force`
  to confirm: `pnpm --filter @workspace/db run push-force`. Always
  back up the DB first when columns are being dropped.
- **systemd can't find `node`.** If you used `nvm`, the binary is in
  `~/.nvm/versions/node/v24.x/bin/node`. Edit the `ExecStart=` line in
  `/etc/systemd/system/goblin-l00t.service` to that absolute path, then
  `sudo systemctl daemon-reload`.
- **nginx `502 Bad Gateway` on `/api`.** The service didn't start —
  `journalctl -u goblin-l00t -n 50` will tell you why (almost always a
  missing/typo'd env var).
- **Stripe webhook never fires.** Check Stripe dashboard → Developers →
  Webhooks. There should be one named `replit-managed-…` pointing at
  `https://goblinl00t.com/api/stripe/webhook`. If it's missing, the
  startup `findOrCreateManagedWebhook` failed — usually a bad
  `STRIPE_SECRET_KEY` or the domain wasn't reachable from Stripe at
  boot. Restart the service after fixing.
- **Twitch sign-in fails with `redirect_uri_mismatch`.** The URL in
  Twitch's app config must match `TWITCH_REDIRECT_URI` exactly (https,
  no trailing slash, exact case).
- **Old PM2 / forever / supervisor process for the previous site is
  still running.** Stop and disable it so it can't fight the new
  systemd unit on port 8080. (`pm2 list`, `pm2 delete <id>`,
  `pm2 unstartup`.)
