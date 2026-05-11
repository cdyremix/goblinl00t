# Goblin L00t

Mischievous goblin-themed Twitch bot + web dashboard for giveaways, loot drops, and chaos commands. Production runs at goblinl00t.com (self-hosted; see `deploy/aws-ec2/RUNBOOK.md`).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API + bot (port 8080, served at `/api`)
- `pnpm --filter @workspace/goblin-dashboard run dev` — React dashboard (`/`)
- `pnpm run typecheck` / `pnpm run build` — across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regen API hooks + Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema (dev); `typecheck:libs` after schema edits

## Stack

pnpm workspaces, Node 24, TS 5.9. **API**: Express 5 + pino. **DB**: Postgres + Drizzle (`lib/db`, composite). **Validation**: Zod (`zod/v4`) + drizzle-zod. **Codegen**: Orval. **Build**: esbuild. **Frontend**: React 18 + Vite + Tailwind v4 + shadcn/ui + Wouter + React Query.

## Layout

- `lib/db/src/schema/` — `giveaways`, `giveaway_entries`, `loot_drops`, `command_logs`, `user_inventory`, `goblin_events`, `users`, `giveaway_presets`, `waitlist_emails`, `app_settings`, `trade_fulfillments`
- `lib/api-spec/openapi.yaml` — source of truth; `lib/api-client-react/src/generated/` = auto-generated (do NOT edit)
- `artifacts/api-server/src/`
  - `bot/` — `bot-service.ts` (tmi.js, multi-channel, offline w/o `TWITCH_OAUTH_TOKEN`), `loot-tables.ts`, `inventory.ts` (5-slot, advisory lock), `goblin-events.ts` (drop/steal scheduler), `points.ts` (`redeemEntriesForUser`, `getPointsBalance`, `clampCoinAward`), `channel-{settings,theme,command-responses,command-toggles}.ts` (per-channel cached; writes MUST call matching `invalidate*`)
  - `routes/` — giveaway, loot, stats, commands, bot, inventory, settings, chat-users, auth, steam, health, admin, stripe, maintenance
  - `lib/auth-helpers.ts` — `requireStreamerChannel` (writes), `resolveStreamerChannelForRead` (dev-fallback to `goblinl00t`), `requireAdmin`, `rateLimit(key, {max, windowMs})`
  - `lib/discord-webhook.ts` (allowlisted; never logs raw err) · `lib/maintenance-{state,guard}.ts` · `lib/stripeClient.ts` (Replit connector OR `STRIPE_SECRET_KEY` self-host fallback)
- `artifacts/goblin-dashboard/src/pages/` — home, dashboard, giveaways (`/giveaway`), giveaway-detail, stats, commands, account, settings, trade-office, help, chat-users, terms, privacy, admin, dev-sign-in (DEV-only)
- `deploy/` — Docker bundle + `aws-ec2/` bare-metal runbook + systemd unit + nginx + `release.sh`

## Key User Columns (`usersTable`)

- `isAdmin` — super-user. `userHasFeature()` short-circuits true. Auto-set in `lib/get-or-create-user.ts` when Clerk primary email ∈ `SUPER_USER_EMAILS` (default `c.borawa@gmail.com`); first grant bumps tier→pro + flips `tierSelected`. Manual via `PATCH /admin/users/:id` (self-demotion guard). Frontend `useSubscriptionTier()` exposes; sidebar + `/admin` route both gate on it.
- `isDev` — bypasses maintenance wall (server-resolved in `/maintenance/status`). Same banner-vs-modal logic as `isAdmin`. Set manually in DB.
- `tierSelected` — flips true on first rank pick. Free is valid. Modal non-dismissible while false.
- `commandResponses` (jsonb) — per-channel `{"!cmd": "template"}`. `renderTemplate` tokens: `{user}` `{balance}` `{commands}` `{theme}`.
- `commandToggles` (jsonb) — per-channel built-in on/off; absent → built-in default. Read via `getToggleFor(channel, canonical, true)`.
- Channel runtime: `lootDropsEnabled`, `coinRedemptionEnabled`, `coinCap`, `goblinEventsEnabled`, `wheelMode`, `wheelSpeed`, `botTheme`, `eliminationFlavorEnabled`, `discordWebhookUrl`, `steamTradeUrl`.
- `streamStartedAt` — **deprecated**; stats `range=stream` / loot `since=stream` fall back to last 12h.

## Product Surfaces

- **Home** (`/`) — landing; pricing at `#pricing` (copy from `lib/plans.tsx`). `/pricing` is a back-compat `<Redirect>`.
- **Dashboard** (`/dashboard`) — Overview (bot status, stats, Recent Winners, live loot feed; stream-window-scoped) + Chat Users tab. Mounts `OnboardingChecklist`.
- **Loot Horde** (`/giveaway`) — hero `SpotlightCard` (Pending → Start, Active → 🎡 Spin Wheel inline), create form, Quick Prize Drop, filterable list. 🧪 dev-gated seed routes `POST /giveaway/seed-test` + `:id/seed-entries` (`FAKE_VIEWERS`). UI says "Loot Horde" but routes/API/chat keep "Hoard".
- **Giveaway Detail** (`/giveaway/:id`) — Start, end (opens wheel; server end-call deferred to wheel's "Draw Winner!"), restart (re-opens ended, preserves entries), inline manual entry add + per-row delete (only while not-ended).
- **Ledger** (`/stats`) — Day/Week/Month/Year/All. CSV export `/stats/export?range=&kind=loot|commands|giveaways` (channel-scoped).
- **Spells** (`/commands`) — toggle, live cooldowns, inline custom-response editor.
- **Forge** (`/settings`) — bot name, theme picker (goblin/cs2), Economy & Loot toggles, Discord webhook, Steam connection + CS2 inventory.
- **Trade Office** (`/trade-office`) — manage CS2 skin delivery (trade URLs, locked items, pending → sent).
- **Chat Users** (`/users`) — every viewer w/ coins or inventory; Adjust Coins dialog.
- **Account** (`/account`) — Tabs `?tab=identity|channel|rank` once on mount. Change-password uses `<PasswordInput>`.
- **Admin Console** (`/admin`) — super-user only (see below).
- **Help** (`/help`); **Terms / Privacy** (`/terms`, `/privacy`) — public, no API.
- **Dev Sign-In** (`/dev-sign-in`) — DEV-only.

## Admin Console (`/admin`)

Server gated by `requireAdmin` (NEVER trust client). All in `routes/admin.ts`.

- **Create user** — `POST /admin/users` `{email, password (≥8), twitchUsername?, subscriptionTier?, isAdmin?}`. Creates Clerk user, then `usersTable` row w/ `tierSelected:true`. Compensating-deletes orphaned Clerk user on post-Clerk failure. Pre-flight 409 on `twitchUsername` collision. `<PasswordInput>` strength meter; `min(8)` enforced server + client.
- **Edit dialog** — *Identity* (`PATCH /:id` for twitchUsername/steamUsername; `/:id/email` for Clerk email change w/ verified+primary, sweeps old non-primaries; `/:id/password` w/ `signOutOfOtherSessions:true`); *Subscription* (tier + isAdmin PATCH; `/:id/subscription/cancel` calls Stripe + clears local); *Billing* (`GET /:id/invoices` joins `stripe.invoices LEFT JOIN charges`; refund verifies chargeId belongs to user's `stripeCustomerId`); *Danger* (`DELETE /:id` cascades: cancel sub → delete Clerk → delete DB row; refuses self).
- **Maintenance Mode** — Switch (`PUT /admin/maintenance` → `app_settings` singleton). `MAINTENANCE_MODE` env overrides ON.

## Stripe Subscriptions

User's Stripe account is source of truth — we never write `stripe.*` schema (managed by `stripe-replit-sync`).

- `lib/stripeClient.ts` — Replit connector first, falls back to `STRIPE_SECRET_KEY` env (self-host). API version pinned to `2026-04-22.dahlia` (must match `scripts/src/lib/stripeClient.ts`).
- **Boot**: `runMigrations()` → `findOrCreateManagedWebhook(https://${REPLIT_DOMAINS[0]}/api/stripe/webhook)` → `sync.syncBackfill({ object: "all" })` (must pass `object:"all"` or it silently no-ops). Gated, never crashes.
- **Webhook**: `/api/stripe/webhook` mounted with `express.raw({ type:"application/json" })` BEFORE `express.json()` AND before maintenance guard. Don't reorder.
- **esbuild**: `stripe-replit-sync` is **externalized** in `build.mjs` — its migrations resolve via `__dirname` and break when bundled.
- **Tier mapping**: each Product carries `metadata.tier ∈ {"premium","pro"}` (set by `scripts/seed-products.ts`). `GET /stripe/subscription` reconciles `usersTable.subscriptionTier` from product metadata on every read.
- **Routes** (Clerk-authed, NO `requireStreamerChannel` so users can subscribe pre-Twitch-link): `prices`, `checkout` (existing active sub + different tier → `subscriptions.update` w/ `proration_behavior:'always_invoice'`; same tier → portal redirect), `portal`, `subscription`, `cancel-at-period-end`, `cancel-now`, `invoices`.
- Re-seed: `pnpm --filter @workspace/scripts run seed-products` (idempotent on `metadata.tier`).

## Bot Commands

Canonicals (Spells page lists only these; aliases share toggle/cooldown/handler):

- `!loot`, `!enter`, `!inventory`, `!sell <slot|all>`, `!use <slot>`, `!giveaway`, `!redeem`, `!tradeurl`, `!steal`/`!scam`
- Customizable: `!help` (`{user}{commands}{theme}`), `!points`/`!coins` (`{user}{balance}`), `!hoard`/`!stash` (`{user}{balance}`), `!goblin`/`!skin` + `!feedgoblin`/`!case` (`{user}{theme}`)

Aliases via `BUILT_IN_COMMANDS[name].aliasOf`; `getCommandConfig()` filters them, emits `aliases[]` on canonical. `toggleCommandEnabled()` propagates. **To add customizable**: tag `customizable:true`, `availableTokens`, `defaultResponse`; handler uses `renderTemplate(getCustomResponseFor(channel,name) ?? DEFAULT, vars)`.

## OAuth & Auth

- **Twitch sign-in** (`routes/auth.ts`) — `account.tsx#startTwitchConnect` calls `GET /api/auth/twitch` via authed fetch, server returns `{url}`, browser does `window.location.assign(url)`. **Do NOT** convert to top-level `<a href>` — Clerk session cookie isn't reliably sent to API origin under proxy. State HMAC-SHA256 signed (`SESSION_SECRET`); callback constant-time verifies. Init rate-limited 10/min/Clerk-user. Env: `TWITCH_CLIENT_ID/SECRET/REDIRECT_URI`. Bot env: `TWITCH_OAUTH_TOKEN`, `TWITCH_BOT_USERNAME`, `TWITCH_CHANNEL`.
- **Steam** (`routes/steam.ts`) — OpenID 2.0. `POST /steam/auth/init` sets signed `steam_oauth_clerk` cookie (HMAC, 10-min, httpOnly/secure/sameSite=lax). Callback verifies via `mode=check_authentication`, parses SteamID64 from `openid.claimed_id`, fetches profile name. `MOCK_STEAM_ID64` honored by `/steam/inventory` for dev.
- **Dev Sign-In** — `POST /api/auth/dev-sign-in` bypasses Clerk OTP/new-device challenges. **Default-closed**: 404 unless `NODE_ENV !== "production"` AND `ENABLE_DEV_SIGN_IN === "true"`. Rate-limited 10/min/IP. Mints token via `clerkClient.signInTokens.createSignInToken({userId, expiresInSeconds:300})`. Frontend uses `useSignIn` from **`@clerk/react/legacy`** (new signal hook lacks `setActive`). Route + sign-in page link both gated on `import.meta.env.DEV`. **Do NOT relax this gate** — never tie to maintenance mode; that's public-facing.

## Security & Multi-Tenancy

- `requireAdmin` — strict 401/403; returns `{user}`. EVERY `/admin/*` MUST start with this.
- `requireStreamerChannel` — strict 401/403; for ALL mutations.
- `resolveStreamerChannelForRead` — read-only convenience; in `NODE_ENV !== "production"` falls back to `"goblinl00t"`. **NEVER for writes.**
- **Giveaway routes channel-scoped**: GETs filter by `ctx.channel`; cross-channel `:id` returns 404 (don't leak existence). POSTs use `requireStreamerChannel` + ignore body-supplied `channel`. Mutations verify ownership against `existing.channel`. Unlinked-`goblinl00t` exception in mutations gated to non-prod.
- **Stats CSV** is `requireStreamerChannel`-scoped. Other `/stats/*` aggregates are global by design (legacy single-tenant).
- **Discord webhook** — host-allowlisted (`discord.com`/`discordapp.com`); `catch` logs only `errName`/`errMessage`/`channel`, NEVER raw `err` (can leak URL).
- **Maintenance guard** (`lib/maintenance-guard.ts`) — mounted at `/api` AFTER `clerkMiddleware`. When ON → 503 EXCEPT (a) allowlist `maintenance/status`, `waitlist`, `healthz`, `readyz`, `users/me`, `auth/*`; (b) `isAdmin` OR `isDev`. Stripe webhook pre-mounted before guard.
- `<MaintenanceGate>` wraps `<AppRouter />` inside Clerk + QueryClient. Off → pass-through; loading → splash; **errored → fail closed**; on + admin/dev → slim banner + full app; on + neither → modal + waitlist + Dev Login link to `/sign-in`. Allowed paths: `/sign-in`, `/terms`, `/privacy`. Refetch every 60s + on focus.
- **Health** — `/api/healthz` (always 200), `/api/readyz` (db ping).

## Important Gotchas

- `pnpm run typecheck:libs` after editing `lib/db/src/schema/` before checking artifacts.
- Don't run `pnpm dev` at root — use workflows or `pnpm --filter`.
- `getGiveawayEntries` has NO `limit` query param (TS2308 collision with path param).
- `currentGiveaway.giveaway` can be null — always `currentGiveaway?.giveaway?.id`.
- `giveaway_entries` has unique `(giveaway_id, username)` — always `onConflictDoUpdate` (see `bot/points.ts#redeemEntriesForUser`); never read-modify-write.
- ALL point-redemption MUST go through `redeemEntriesForUser()` (serializable txn). `POST /giveaway/:id/redeem` is Clerk-authed and operates on caller's linked `twitchUsername` only.
- Sub-tier detection: `tags.badges?.subscriber` (`"2000"`/`"3000"` = T2/T3, else T1). `badges-raw`/`badge-info` are NOT reliable.
- Follower gating is best-effort; falls open without `TWITCH_CLIENT_ID`/`OAUTH_TOKEN` or stored `twitchUserId`.
- **`prizeKind`** ∈ `cs2` (manual via Trade Office) / `bot_item` (auto-rolls into pouch; falls back to coin credit if full) / `bot_coins` (direct credit). Always serialize all three (`prizeKind`, `prizeBotCoins`, `prizeBotRarity`). **Combo prizes**: `prizeBotCoins` carries through for ALL kinds — main reward for `bot_coins`, optional bonus on top for `cs2`/`bot_item` (separate `loot_drops` row labeled `"Giveaway Bonus: <title>"`).
- **Theme threading**: `rollLootDrop` filters `LOOT_TABLE` by `opts.theme`; ALL call sites must pass it (`bot-service.ts !loot`, `routes/giveaway.ts bot_item` use `getChannelTheme()`; `routes/loot-hoard.ts` reads `user.botTheme`). Forgetting silently defaults to goblin items on CS2 channels.
- **Inventory cap** is 5 slots per (channel, username). All inserts MUST go through `addInventoryItem()` (per-user `pg_advisory_xact_lock`). Luck-buff `consumeLuckOnSuccess:true` is atomic; "full" never burns the charge. Ticket buff (`!enter`) consumed only after entry insert lands.
- **Username casing**: chat inserts normalize via `tags.username.toLowerCase()`. Historical mixed-case rows backfilled once.
- `getPointsBalance(username, channel?)` — channel optional but pass it everywhere we know it. Cap only resolves when channel supplied.
- **Multi-tenant scoping** — channel-scoped via `resolveStreamerChannelForRead`/`requireStreamerChannel` and MUST stay that way: `routes/{stats,inventory,giveaway}.ts`. Bot handlers `!enter`/`!redeem`/`!giveaway` filter active-giveaway by `giveawaysTable.channel == chat channel`. `redeemEntriesForUser` filters BOTH balance read AND redemption insert by `giveaway.channel` — coins earned in channel A cannot spend into channel B (tenancy boundary, not just UX).
- **Multi-channel bot** — `bot-service.ts#loadJoinableChannels` queries every linked `twitchUsername` ∪ `TWITCH_CHANNEL` env ∪ `goblinl00t` fallback, dedupes lowercase. Dynamic `joinChannel(name)`/`partChannel(name)` keep membership in sync without restart: Twitch-link callback → `joinChannel` + `reloadCustomCommands()`; admin user delete → `partChannel`; admin PATCH that changes `twitchUsername` → part old + join new + `reloadCustomCommands()`.
- **Per-channel theme** (`bot/channel-theme.ts`) — `getChannelTheme(channel)` / `getChannelThemePhrases(channel)` / `invalidateChannelTheme(channel)` (mirrors `channel-settings.ts` cache pattern). Bot resolves theme ONCE per message and threads into every theme-branched site. Settings PUT MUST `invalidateChannelTheme(twitchUsername)`. Replaces global `setActiveTheme`/`getActiveTheme`.
- **Built-in toggle write race** — `POST /commands/:name/toggle` is snapshot read-modify-write on `commandToggles`; near-simultaneous toggles can lose one update. Single-tenant in scope. Switch to `jsonb_set(...)` if it ever matters.
- **`coinCap`** is HARD per-channel limit. `clampCoinAward(channel, username, requested)` (and `clampCoinAwardTx`) reads the **streamer's** `coinCap` (lookup by `twitchUsername == channel`, NOT viewer's row). EVERY coin-credit insert MUST go through it: `bot/inventory.ts#sellInventoryItem` (uses `clampCoinAwardTx` via dynamic import for circular-load), `bot/goblin-events.ts#fireDrop`, `routes/loot-hoard.ts`, `routes/chat-users.ts` (positive adjustments), `routes/giveaway.ts#awardCoins`.
- `!loot` / `/loot-hoard/drop` pass `allowBuffs:false` when `lootDropsEnabled` OFF or for streamer manual drops.
- Random Goblin Events use in-memory `RECENT_CHATTERS` per channel — only fires after viewers have spoken since bot start. Steals silently skip when balance ≤ 0.

## Elimination Wheel

`components/elimination-wheel.tsx` — wheel picks winner organically (server NO LONGER pre-picks). On "Start Eliminations", runs `pickWeightedWinner(entries)` (weighted random by tickets), builds elimination order. Reports via `onWinnerDecided(username)` → parent passes to `useEndGiveaway`. `POST /giveaway/:id/end` accepts optional `winnerUsername` (validates it's in pool, 400 if not); body-less callers still get legacy server-side pick.

**Props**: `entries`, `mode`, `speed`, `flavorEnabled` (required); `winner` (REPLAY ONLY — re-opening ended; live flow MUST omit); `onWinnerDecided` (called once per open at phase→`revealed`, guarded by `winnerReportedRef`); `recordingWinner` (cosmetic). `onDrawWinner`/`drawingWinner`/pre-fetched `winner` flow is REMOVED — do not reintroduce.

**Single phase-driven footer CTA**: `idle`→**Start Eliminations** (`handleStart` picks winner locally + `setTimeout(50)` defer before `phase="spinning"`); `final-two`→**Start Final Battle** (streamer drives manually; auto-pause useEffect REMOVED); `revealed`→**Continue** (`onClose`); `spinning`/`shuffling`/`fight` hide all CTAs.

**Pixel-fight final** (`pixel-fight-scene.tsx`) — ~5s CSS-pixel-sprite fight. `prefers-reduced-motion` → immediate `onDone`. After `onDone`, wheel re-invokes `revealWinner` via `setTimeout(50)` — **do not remove that micro-defer** or React batching swallows the phase transition.

## Production Deployment

Self-hosted on AWS EC2 at goblinl00t.com. Bare-metal (host nginx + systemd + local Postgres). Bundle in `deploy/aws-ec2/`:

- `RUNBOOK.md` — full first-deploy walkthrough + day-2 ops + rollback
- `release.sh` — idempotent build + atomic dashboard swap into `/opt/goblinl00t/web` + `drizzle-kit push` + service restart. Run after every `git pull`.
- `goblin-l00t.service` — systemd unit (reads `/etc/goblinl00t.env`)
- `nginx-goblinl00t.conf` — site config (proxies `/api`, serves SPA, real-IP scoped to RFC1918)

Docker bundle in `deploy/` (`Dockerfile` + `docker-compose.yml` + `nginx.conf`) is also kept as an alternative. **Stripe self-host**: `stripeClient.ts` falls back to `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` env when Replit connector env absent.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
