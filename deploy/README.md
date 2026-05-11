# Goblin L00t — Self-Host Deployment

Deploys the API server, Twitch bot, and dashboard as a single Docker
Compose stack behind nginx. Designed for any Linux VPS with Docker 24+.

## Stack topology

```
                ┌────────────────────────────────────────┐
       :80 ────►│ nginx                                  │
                │   /api/*  → app:8080 (api-server)      │
                │   /*      → static dashboard (volume)  │
                └─────────────┬──────────────────────────┘
                              │
                ┌─────────────▼──────────┐    ┌─────────────────┐
                │ app  (node 24, esbuild │◄──►│ db (postgres 16)│
                │   bundle + tmi.js bot) │    │   named volume  │
                └────────────────────────┘    └─────────────────┘
```

## What's NOT included

- **TLS.** Terminate it either at this nginx (`listen 443 ssl` + certbot)
  or at an upstream LB (Cloudflare, AWS ALB). The included `nginx.conf`
  trusts `X-Forwarded-Proto`, so HTTP-from-an-LB is fine.
- **External Postgres.** The `db` service is fine for one-box deploys.
  Swap in a managed Postgres by deleting the `db` service and pointing
  `DATABASE_URL` at it directly.
- **Backups.** Set up `pg_dump` on a cron — the named volume
  `goblin-pgdata` survives container restarts but not host loss.

## First-time deploy

```bash
# 1. Get the code onto the box
git clone <your-fork-url> goblinl00t && cd goblinl00t/deploy

# 2. Configure
cp .env.example .env
$EDITOR .env             # fill in REQUIRED values (see below)

# 3. Point DNS for goblinl00t.com → the host's public IP

# 4. Build + boot
docker compose --env-file .env build
docker compose --env-file .env up -d

# 5. Watch the boot
docker compose logs -f app
```

The `app` container runs `pnpm --filter @workspace/db run push` on boot
(idempotent — Drizzle diffs the schema and applies whatever's missing),
then starts the api-server bundle. First boot also triggers Stripe sync
backfill + webhook registration via `findOrCreateManagedWebhook`.

## Required `.env` values

| Variable                         | Why                                                                                    |
|----------------------------------|----------------------------------------------------------------------------------------|
| `PUBLIC_HOST`                    | `goblinl00t.com`. Drives Stripe webhook URL, Twitch OAuth callback, Clerk proxy host. |
| `POSTGRES_PASSWORD`              | Strong random — `openssl rand -hex 32`.                                               |
| `SESSION_SECRET`                 | HMAC key for Twitch state + Steam cookie. `openssl rand -hex 32`.                     |
| `VITE_CLERK_PUBLISHABLE_KEY`     | Build-time. Baked into static bundle. Re-build image when rotated.                    |
| `CLERK_PUBLISHABLE_KEY`          | Runtime. Server-side companion (`pk_live_…`).                                         |
| `CLERK_SECRET_KEY`               | Runtime. Clerk Backend API + Clerk proxy.                                             |
| `TWITCH_CLIENT_ID` / `_SECRET`   | OAuth app from <https://dev.twitch.tv/console/apps>. Set the OAuth Redirect URL on the Twitch app to `https://goblinl00t.com/api/auth/twitch/callback`. |
| `STRIPE_SECRET_KEY`              | Live `sk_live_…` from your Stripe dashboard. The server-side `stripeClient.ts` falls back to this when no Replit connector env is present (which is always the case on a VPS). |

Optional but commonly wanted:

| Variable               | Why                                                                                |
|------------------------|------------------------------------------------------------------------------------|
| `TWITCH_OAUTH_TOKEN`   | Bot will join channels & read/write chat. Without it the bot stays offline (API still works). Get one at <https://twitchtokengenerator.com> with `chat:read chat:edit channel:moderate` scopes for the `goblinl00t` bot account. |
| `SUPER_USER_EMAILS`    | Comma-separated. First sign-in with one of these auto-promotes the user to `isAdmin = true`. Defaults to `c.borawa@gmail.com`. |
| `MAINTENANCE_MODE=1`   | Emergency lockdown — forces the launch wall ON regardless of admin toggle.        |

## Day-2 operations

```bash
# Tail app logs
docker compose logs -f app

# Manually re-sync DB schema (entrypoint runs this on every boot, but
# safe to call ad-hoc after a code change you just deployed):
docker compose exec app pnpm --filter @workspace/db run push

# Open a psql shell into the bundled DB
docker compose exec db psql -U goblin -d goblin

# Hot-restart the bot/api after env-only change (no rebuild)
docker compose up -d app

# Roll a new code release
git pull
docker compose --env-file .env build app init-static
docker compose --env-file .env up -d app init-static nginx

# Backups (recommended cron)
docker compose exec -T db pg_dump -U goblin goblin | gzip > goblin-$(date +%F).sql.gz
```

## Updating the dashboard separately

The static dashboard is shipped via the `init-static` one-shot, which
copies `/app/artifacts/goblin-dashboard/dist/public/` from the freshly
built `app` image into the `goblin-dashboard` named volume that nginx
serves from. To deploy a dashboard-only change:

```bash
docker compose --env-file .env build app init-static
docker compose --env-file .env up -d init-static
# nginx is already serving the volume, no restart needed.
```

## Stripe webhook

On boot the api-server calls `findOrCreateManagedWebhook(https://${PUBLIC_HOST}/api/stripe/webhook)`
against your live Stripe account. You'll see it land in the Stripe
dashboard under **Developers → Webhooks** with name `replit-managed-…`.
The bundled `stripe-replit-sync` package keeps `stripe.*` tables in your
Postgres up-to-date with the live data — never write to those tables.

## Clerk: custom domain

1. In Clerk's dashboard, create a **Production** instance.
2. Add `goblinl00t.com` as a Frontend API allowed origin.
3. Set Authentication → Frontend API URL to use **proxy mode** with
   path `/api/__clerk` (the bundled `clerkProxyMiddleware` handles this
   path — no DNS CNAME needed).
4. Copy the publishable + secret keys into `.env` and re-build:
   `docker compose --env-file .env build app init-static && docker compose up -d`.

## Twitch: bot account

The chat bot logs in as `TWITCH_BOT_USERNAME` (default `goblinl00t`)
using `TWITCH_OAUTH_TOKEN`. Generate the token by signing in to
<https://twitchtokengenerator.com> as the bot account and copying the
"OAuth Token" with scopes `chat:read chat:edit channel:moderate`.
The bot auto-joins every linked streamer's channel via
`bot/bot-service.ts#loadJoinableChannels` — no manual JOIN needed.

## Troubleshooting

- **`db` healthcheck flapping.** Postgres on cold-start needs ~10s on
  first boot to initialize the data dir; the `app` container waits for
  `service_healthy`, so just give it a minute.
- **`drizzle-kit push` complains about destructive changes.** Run it
  manually with `--force` to confirm: `docker compose exec app pnpm --filter @workspace/db run push-force`.
- **Twitch OAuth fails with `redirect_uri_mismatch`.** The URL in your
  Twitch app's "OAuth Redirect URLs" list must match
  `${PUBLIC_HOST}/api/auth/twitch/callback` exactly (https, no trailing
  slash).
- **Stripe webhook 400s.** The raw-body middleware is sensitive to
  intermediate proxies that re-encode the request. The included nginx
  config sets `proxy_request_buffering off` for `/api/` for that reason
  — don't enable Cloudflare's "Auto Minify" or any body-rewriting layer
  in front of `/api/stripe/webhook`.
- **Maintenance wall stuck on for an admin/dev account.** The flags are
  `is_admin` / `is_dev` on the `users` table. Flip them via the Admin
  Console (sidebar → Admin) or directly in psql.
