# Goblin L00t

A mischievous goblin-themed Twitch bot + web dashboard for running giveaways, loot drops, and chaos commands in Twitch chat.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/goblin-dashboard run dev` — React dashboard (served at `/`)
- `pnpm run typecheck` / `pnpm run build` — across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regen API hooks + Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm run typecheck:libs` — rebuild composite lib declarations (run after DB schema changes)

## Stack

pnpm workspaces, Node 24, TS 5.9. API: Express 5 + pino. DB: Postgres + Drizzle ORM (`lib/db`, composite). Validation: Zod (`zod/v4`) + drizzle-zod. Codegen: Orval. Build: esbuild (CJS). Frontend: React 18 + Vite + TailwindCSS v4 + shadcn/ui + Wouter + React Query. Proxy: `/api` → api-server, `/` → dashboard.

## Layout

- `lib/db/src/schema/` — DB schema (giveaways, giveaway_entries, loot_drops, command_logs, user_inventory, goblin_events, users, giveaway_presets, waitlist_emails, app_settings, trade_fulfillments)
- `lib/api-spec/openapi.yaml` — source of truth; `lib/api-client-react/src/generated/` = auto-generated hooks (do not edit)
- `artifacts/api-server/src/`
  - `bot/bot-service.ts` — tmi.js bot (offline if no `TWITCH_OAUTH_TOKEN`); multi-channel join layer (see Bot below)
  - `bot/loot-tables.ts`, `bot/inventory.ts` (5-slot, advisory lock), `bot/goblin-events.ts` (drop/steal scheduler), `bot/points.ts` (`redeemEntriesForUser`, `getPointsBalance`, `clampCoinAward`)
  - `bot/channel-settings.ts`, `bot/channel-theme.ts`, `bot/command-responses.ts`, `bot/command-toggles.ts` — per-channel cached settings (all writes MUST call the matching `invalidate*`)
  - `routes/` — giveaway, loot, stats, commands, bot, inventory, settings, chat-users, auth, steam, health, admin, stripe, maintenance
  - `lib/auth-helpers.ts` — `requireStreamerChannel` (writes), `resolveStreamerChannelForRead` (dev-fallback to `goblinl00t`), `requireAdmin`, `rateLimit({max, windowMs})`
  - `lib/discord-webhook.ts` — host-allowlisted; never logs raw err
  - `lib/maintenance-state.ts` + `lib/maintenance-guard.ts` — see Maintenance Mode
- `artifacts/goblin-dashboard/src/`
  - `pages/` — home, dashboard, giveaways (`/giveaway`), giveaway-detail, stats, commands, account, settings, trade-office, help, chat-users, terms, privacy, admin, dev-sign-in (DEV-only)
  - `components/layout.tsx` — sidebar + footer + `<OnboardingTour />` + `<TierSelectModal />`
  - `components/password-input.tsx` — shared password field (eye toggle, 0–4 strength meter via `scorePasswordStrength`)
  - `components/maintenance-gate.tsx`, `components/error-boundary.tsx`, `components/onboarding-checklist.tsx`
  - `components/elimination-wheel.tsx` + `pixel-fight-scene.tsx` — see Elimination Wheel

## Key DB Columns (on `usersTable`)

- `isAdmin` (bool) — super-user flag. `userHasFeature()` short-circuits true for everything; `requireAdmin` middleware lets the row owner hit `/api/admin/*`. Auto-set in `lib/get-or-create-user.ts` when Clerk primary email matches `SUPER_USER_EMAILS` env (default `c.borawa@gmail.com`); first-time grant bumps `subscriptionTier` → `pro` and flips `tierSelected`. Manual flips via `PATCH /admin/users/:id` (self-demotion guard). Frontend `useSubscriptionTier()` exposes it; sidebar Admin Console link + `/admin` route both gate on it.
- `tierSelected` (bool) — flips true on first rank pick in `<TierSelectModal>`. Both `PUT /users/me/subscription` and `PUT /users/me/tier-acknowledge` set it. Free is valid. Modal is non-dismissible while false.
- `commandResponses` (jsonb) — per-channel `{"!cmd": "template"}`. Tokens via `renderTemplate`: `{user}`, `{balance}`, `{commands}`, `{theme}`.
- `commandToggles` (jsonb) — per-channel built-in command on/off (canonical names; aliases share the canonical's flag). Absent key → built-in default. Read via `getToggleFor(channel, canonical, true)`.
- `discordWebhookUrl` — fired on giveaway end (allowlisted; see Security).
- Channel runtime settings (`lootDropsEnabled`, `coinRedemptionEnabled`, `coinCap`, `goblinEventsEnabled`, `wheelMode`, `wheelSpeed`, `botTheme`, `eliminationFlavorEnabled`).
- `steamTradeUrl` — auto-populated on Steam OAuth; bot uses winner trade URLs from `tradeFulfillmentsTable.steamTradeUrl` (collected via `!tradeurl`).
- `streamStartedAt` — **deprecated**; `routes/stats.ts` (`range=stream`) and `routes/loot.ts` (`since=stream`) fall back to last 12h.

## Product Surfaces

- **Home** (`/`) — public landing; pricing lives at `#pricing` anchor (tier copy sourced from `lib/plans.tsx`). `/pricing` is a `<Redirect>` for back-compat.
- **Dashboard** (`/dashboard`) — Overview tab (bot status, stats, Recent Winners, live loot feed; scoped to stream window) + Chat Users tab. Mounts `OnboardingChecklist`.
- **Loot Horde** (`/giveaway`) — hero `SpotlightCard` (Pending → Start, Active → 🎡 Spin Wheel inline), create form, Quick Prize Drop, filterable list. 🧪 dev-gated seed routes `POST /giveaway/seed-test` + `POST /giveaway/:id/seed-entries` (`FAKE_VIEWERS` in `routes/giveaway.ts`). Page title says "Loot Horde" but route/API/chat names keep original "Hoard" spelling.
- **Giveaway Detail** (`/giveaway/:id`) — Start, end (opens wheel; the actual server end-call is deferred to the wheel's "Draw Winner!" button), restart (re-opens an ended giveaway, preserves entries), inline manual entry add + per-row delete (only while not-ended).
- **Ledger** (`/stats`) — Day/Week/Month/Year/All. Engagement Tips via `GET /stats/engagement`. CSV export (channel-scoped) `/stats/export?range=&kind=loot|commands|giveaways`.
- **Spells** (`/commands`) — toggle commands; live cooldowns; inline custom-response editor for `customizable: true` commands.
- **Forge** (`/settings`) — bot name, theme picker (goblin/cs2), Economy & Loot toggles, Discord webhook URL, Steam connection + CS2 inventory grid.
- **Trade Office** (`/trade-office`) — manage CS2 skin delivery (trade URLs, locked items, status pending → sent).
- **Chat Users** (`/users`) — every viewer who's earned/redeemed coins or held inventory; Adjust Coins dialog.
- **Account** (`/account`) — `Tabs defaultValue` reads `?tab=identity|channel|rank` once on mount. Change-password dialog uses `<PasswordInput>`.
- **Admin Console** (`/admin`) — super-user only. Roster + stat cards + per-row Edit/Delete. See Admin section below.
- **Help & Guide** (`/help`); **Terms / Privacy** (`/terms`, `/privacy`) — public, no API calls.
- **Dev Sign-In** (`/dev-sign-in`) — DEV-only route that bypasses Clerk's email + new-device verification (see Dev Sign-In below).

## Admin Console (`/admin`)

Server gated by `requireAdmin` (NEVER trust client `isAdmin`). All in `routes/admin.ts`.

- **Create user** — `POST /admin/users` body `{email, password (≥8), twitchUsername?, subscriptionTier?, isAdmin?}`. Creates Clerk user via `clerkClient.users.createUser` THEN inserts `usersTable` row with `tierSelected:true`. On post-Clerk failure → compensating-deletes the orphaned Clerk user. Pre-flight 409 if `twitchUsername` collides. Dialog uses shared `<PasswordInput>` (eye toggle + strength meter); `min(8)` enforced both server and client (no bypass).
- **Edit dialog** (Identity / Subscription / Billing / Danger):
  - *Identity*: PATCH `twitchUsername`/`steamUsername` via `/admin/users/:id`; email change via `/admin/users/:id/email` (Clerk `emailAddresses.createEmailAddress` w/ verified+primary, sweeps old non-primaries); temp password via `/admin/users/:id/password` (`signOutOfOtherSessions: true`, also `min(8)`).
  - *Subscription*: tier + `isAdmin` PATCH (manual entitlement override — re-overwritten on next `/stripe/subscription` read if active sub); `POST /admin/users/:id/subscription/cancel` calls `stripe.subscriptions.cancel` and clears local `stripeSubscriptionId`/tier.
  - *Billing*: `GET /admin/users/:id/invoices` joins `stripe.invoices LEFT JOIN stripe.charges`. Refund button posts `/admin/users/:id/refund` (full, `requested_by_customer`). Server VERIFIES chargeId belongs to the user's `stripeCustomerId` before issuing.
  - *Danger*: `DELETE /admin/users/:id` cascade = (1) cancel Stripe sub, (2) `clerkClient.users.deleteUser`, (3) DB delete (FK cascades wipe `custom_commands` + `giveaway_presets`; channel-scoped chat history rows are intentionally orphaned for Ledger continuity). Refuses to delete/demote self.

## Stripe Subscriptions

Real recurring billing via the Replit Stripe connector. The user's Stripe account is source of truth — we never write to the `stripe.*` schema (managed by `stripe-replit-sync`).

- `lib/stripeClient.ts` lazily inits Stripe SDK + `StripeSync`. API version pinned to `2026-04-22.dahlia` (must match in `scripts/src/lib/stripeClient.ts`).
- **Boot** (gated, never crashes): `runMigrations()` once → `findOrCreateManagedWebhook(<https://${REPLIT_DOMAINS[0]}/api/stripe/webhook>)` → `sync.syncBackfill({ object: "all" })` (**must pass `object: "all"`**; without it the package silently no-ops).
- **Webhook**: `/api/stripe/webhook` mounted with `express.raw({ type: "application/json" })` BEFORE `express.json()` in `app.ts`. Don't reorder. Pre-mounted before maintenance guard.
- **esbuild**: `stripe-replit-sync` is **externalized** in `build.mjs` — its migrations resolve via `__dirname` and break when bundled.
- **Tier mapping**: each Stripe Product carries `metadata.tier ∈ {"premium","pro"}` (set by `scripts/seed-products.ts`). `GET /stripe/subscription` reconciles `usersTable.subscriptionTier` from product metadata on every read.
- **Routes** (Clerk-authed, NO `requireStreamerChannel` so users can subscribe pre-Twitch-link): `GET /stripe/prices`, `POST /stripe/checkout` (pro-ration path: existing active sub + different tier → `subscriptions.update` w/ `proration_behavior:'always_invoice'`; same tier → portal redirect; falls back to fresh Checkout on error), `POST /stripe/portal`, `GET /stripe/subscription`, `POST /stripe/subscription/cancel-at-period-end`, `POST /stripe/subscription/cancel-now`, `GET /stripe/invoices`.
- **Re-seed prices**: `pnpm --filter @workspace/scripts run seed-products` (idempotent on `metadata.tier`).

## Bot Commands

Canonicals (Spells page lists only these; aliases share toggle/cooldown/handler):
- `!loot`, `!enter`, `!inventory`, `!sell <slot|all>`, `!use <slot>`, `!giveaway`, `!redeem`, `!tradeurl`
- `!help` (customizable; `{user}` `{commands}` `{theme}`)
- `!points` / `!coins` (customizable; `{user}` `{balance}`)
- `!hoard` / `!stash` (customizable; `{user}` `{balance}`)
- `!goblin` / `!skin` (customizable; `{user}` `{theme}`)
- `!feedgoblin` / `!case` (customizable; `{user}` `{theme}`)
- `!steal` / `!scam`

Aliases declared via `BUILT_IN_COMMANDS[name].aliasOf`; `getCommandConfig()` filters them, emits `aliases[]` on canonical. `toggleCommandEnabled()` propagates to all aliases. **To add a customizable command**: tag `customizable: true`, `availableTokens`, `defaultResponse`; handler uses `renderTemplate(getCustomResponseFor(channel, name) ?? DEFAULT, vars)`.

## Twitch / Steam OAuth

- **Twitch sign-in** (`routes/auth.ts`) — `pages/account.tsx#startTwitchConnect` calls `GET /api/auth/twitch` via authed fetch, server returns `{url}`, browser does `window.location.assign(url)`. **Do NOT** convert this to a top-level `<a href>` — Clerk's session cookie isn't reliably sent to the API origin under the proxy. Callback redirects to `/account?tab=channel&connected=twitch`. State HMAC-SHA256 signed (keyed on `SESSION_SECRET`); callback constant-time verifies. Init endpoint rate-limited 10/min/Clerk-user. Requires `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`. Bot env: `TWITCH_OAUTH_TOKEN`, `TWITCH_BOT_USERNAME`, `TWITCH_CHANNEL` (without them bot stays offline; API/dashboard still work).
- **Steam sign-in** (`routes/steam.ts`) — Steam OpenID 2.0. `POST /api/steam/auth/init` sets signed `steam_oauth_clerk` cookie (HMAC, 10-min, httpOnly/secure/sameSite=lax) + returns `{url}`. Callback verifies via `mode=check_authentication`, parses SteamID64 from `openid.claimed_id`, fetches profile name via `steamcommunity.com/profiles/<id>/?xml=1`. `MOCK_STEAM_ID64` honored by `/steam/inventory` for dev.

## Dev Sign-In (DEV ONLY)

`POST /api/auth/dev-sign-in` (in `routes/auth.ts`) bypasses Clerk's email-OTP and new-device verification challenges that block QA. **Default-closed**: returns 404 unless BOTH `NODE_ENV !== "production"` AND `ENABLE_DEV_SIGN_IN === "true"` (defense-in-depth — `NODE_ENV` alone is fragile if a prod host is misconfigured). The dev workflow `pnpm dev` script sets both. Rate-limited 10/min/IP. Looks up Clerk user by email via `clerkClient.users.getUserList({emailAddress})`, mints a sign-in token via `clerkClient.signInTokens.createSignInToken({userId, expiresInSeconds: 300})`, returns `{ticket}`. Frontend `pages/dev-sign-in.tsx` uses `useSignIn` from **`@clerk/react/legacy`** (the new signal-based hook from `@clerk/react` doesn't expose `setActive`/`create`), exchanges via `signIn.create({strategy: "ticket", ticket})` + `setActive`, redirects to `/dashboard`. Route mounted in `App.tsx` gated behind `import.meta.env.DEV` (Vite tree-shakes for prod). Sign-in page renders a small "Dev: skip email verification →" link to `/dev-sign-in` under the same DEV gate. **Do NOT relax the dev-only gate** (e.g. don't tie to maintenance mode — that's a public-facing toggle and would let anyone mint sessions). Clerk's universal `424242` code does NOT cover the new-device challenge, which is why this exists.

## Security & Multi-Tenancy

- **`requireAdmin(req, res)`** — strict; 401 unauthed, 403 if not admin. Returns `{ user }` (full row). EVERY `/admin/*` endpoint MUST start with this.
- **`requireStreamerChannel`** — strict; 401 unauthed, 403 if Twitch not linked. Use for ALL mutations.
- **`resolveStreamerChannelForRead`** — read-only convenience: in `NODE_ENV !== "production"` falls back to `"goblinl00t"` for unlinked accounts. Production behaves identically to `requireStreamerChannel`. **NEVER for writes.**
- **Giveaway routes channel-scoped**: GETs use `resolveStreamerChannelForRead` and filter by `ctx.channel`; cross-channel `:id` returns 404 (don't leak existence). POST `/giveaway` uses `requireStreamerChannel` and ignores body-supplied `channel`. Mutations verify ownership against `existing.channel`. Unlinked-`goblinl00t` exception in mutations is gated to `NODE_ENV !== "production"`.
- **Stats CSV export** is `requireStreamerChannel`-scoped. Other `/stats/*` aggregates are global by design (legacy single-tenant Ledger).
- **Discord webhook** — host-allowlisted (`discord.com` / `discordapp.com`); `catch` logs only `errName`/`errMessage`/`channel`, NEVER raw `err` (fetch errors can leak the secret URL). Settings UI regex matches server allowlist.
- **Health** — `/api/healthz` (always 200), `/api/readyz` (db ping).

## Maintenance Mode

Public launch wall. Primary toggle: Switch in **Admin Console → Maintenance Mode** (`PUT /admin/maintenance` → `app_settings` singleton). `MAINTENANCE_MODE` env var still overrides — when truthy forces ON, admin Switch locked + annotated. State source of truth: `lib/maintenance-state.ts` (5s in-memory cache, busted on `setMaintenanceEnabled`).

- `GET /api/maintenance/status` (public, reads optional Clerk session) → `{ enabled, isAdmin, isDev }`. Both flags server-resolved, never trusted from client.
- `POST /api/waitlist` (public, rate-limited 5/min/IP) — `{ email, source? }`, idempotent via `onConflictDoNothing`. Always returns `{ ok: true }` so probes can't enumerate.
- Server enforcement via `lib/maintenance-guard.ts` (mounted at `/api` AFTER `clerkMiddleware`). When ON → 503 EXCEPT: (a) allowlist `maintenance/status`, `waitlist`, `healthz`, `readyz`, `users/me`, `auth/*` (Twitch round-trip; `dev-sign-in` falls under `auth/*` but is also dev-only at the route level); (b) `usersTable.isAdmin === true` OR `usersTable.isDev === true` (dev/QA accounts bypass the wall too — that's the entire point of the `isDev` flag). Stripe webhook pre-mounted before guard.
- Frontend `<MaintenanceGate>` wraps `<AppRouter />` inside Clerk + QueryClient providers. status off → pass-through; loading → neutral splash; **errored → fail closed**; on + admin/dev → slim banner + full app (banner copy distinguishes the two flags); on + neither → full-screen modal with notify-me + Dev Login link to `/sign-in`. Allowed-through paths: `/sign-in`, `/terms`, `/privacy`. Refetches every 60s + on focus.
- Admin endpoints: `GET /admin/maintenance` → `{ enabled, envOverride }`; `PUT /admin/maintenance` → invalidates the public status query. Both `requireAdmin`.

## Important Gotchas

- `pnpm run typecheck:libs` after editing `lib/db/src/schema/` before checking artifacts.
- Don't run `pnpm dev` at root — use workflows or `pnpm --filter`.
- `getGiveawayEntries` does NOT have a `limit` query param (TS2308 collision with path param).
- `currentGiveaway.giveaway` can be null — always `currentGiveaway?.giveaway?.id`.
- `giveaway_entries` has unique `(giveaway_id, username)` — always insert via `onConflictDoUpdate` (see `bot/points.ts#redeemEntriesForUser`); never read-modify-write.
- ALL point-redemption flows MUST go through `redeemEntriesForUser()` (serializable txn). `POST /giveaway/:id/redeem` is Clerk-authed and operates on caller's linked `twitchUsername` only.
- Sub-tier detection: `tags.badges?.subscriber` (`"2000"`/`"3000"` = T2/T3, else T1). `badges-raw` and `badge-info` are NOT reliable.
- Follower gating is best-effort; falls open without `TWITCH_CLIENT_ID` / `TWITCH_OAUTH_TOKEN` or stored `twitchUserId`.
- **`prizeKind`** ∈ `cs2` (manual via Trade Office) / `bot_item` (auto-rolls into pouch; falls back to coin credit if full) / `bot_coins` (direct credit). Always serialize all three (`prizeKind`, `prizeBotCoins`, `prizeBotRarity`). **Combo prizes**: `prizeBotCoins` carries through for ALL kinds — main reward for `bot_coins`, optional bonus on top for `cs2`/`bot_item` (separate `loot_drops` row labeled `"Giveaway Bonus: <title>"`).
- **Theme threading**: `rollLootDrop` filters `LOOT_TABLE` by `opts.theme`; ALL call sites must pass it (`bot-service.ts !loot`, `routes/giveaway.ts bot_item` use `getChannelTheme()`; `routes/loot-hoard.ts` reads `user.botTheme`). Forgetting silently defaults to goblin items on CS2 channels.
- **Inventory cap** is 5 slots per (channel, username). All inserts MUST go through `addInventoryItem()` (per-user `pg_advisory_xact_lock`). Luck-buff `consumeLuckOnSuccess: true` is atomic; "full" never burns the charge. Ticket buff (`!enter`) consumed only after entry insert lands.
- **Username casing**: chat inserts normalize via `tags.username.toLowerCase()`. Historical mixed-case rows backfilled once.
- **`getPointsBalance(username, channel?)`** — channel optional but pass it everywhere we know it. Cap only resolves when channel is supplied.
- **Multi-tenant scoping** — channel-scoped via `resolveStreamerChannelForRead` / `requireStreamerChannel` and MUST stay that way: `routes/stats.ts`, `routes/inventory.ts`, `routes/giveaway.ts`. Bot chat handlers `!enter`/`!redeem`/`!giveaway` filter active-giveaway lookup by `giveawaysTable.channel == chat channel`. `redeemEntriesForUser` filters BOTH balance read AND redemption insert by `giveaway.channel` — coins earned in channel A cannot be spent into channel B's giveaway (tenancy boundary, not just UX).
- **Multi-channel bot** — `bot/bot-service.ts#loadJoinableChannels` queries every linked `usersTable.twitchUsername` (∪ `TWITCH_CHANNEL` env ∪ `goblinl00t` fallback), dedupes lowercase. `BotState.channels` exposes live join list; legacy `BotState.channel` kept for back-compat. Dynamic `joinChannel(name)` / `partChannel(name)` exports keep membership in sync without restart: Twitch-link callback → `joinChannel` + `reloadCustomCommands()`; admin user delete → `partChannel`; admin PATCH that changes `twitchUsername` → part old + join new + `reloadCustomCommands()`.
- **Per-channel theme** (`bot/channel-theme.ts`) — `getChannelTheme(channel)` / `getChannelThemePhrases(channel)` / `invalidateChannelTheme(channel)` (mirrors `channel-settings.ts` cache pattern). Bot chat handler resolves theme ONCE per message into `channelTheme` and threads it into every theme-branched site. Settings PUT MUST `invalidateChannelTheme(twitchUsername)`. Replaces module-global `setActiveTheme`/`getActiveTheme`.
- **Built-in toggle write race** — `POST /commands/:name/toggle` is snapshot read-modify-write on `commandToggles` JSONB; near-simultaneous toggles on the same channel can lose one update. Single-tenant in scope. Switch to `jsonb_set(...)` if it ever matters.
- **`coinCap`** is HARD per-channel limit. `clampCoinAward(channel, username, requested)` (and `clampCoinAwardTx`) reads the **streamer's** `usersTable.coinCap` (looked up by `twitchUsername == channel`, NOT viewer's row). EVERY coin-credit insert MUST go through it: `bot/inventory.ts#sellInventoryItem` (uses `clampCoinAwardTx` via dynamic import for circular-load avoidance), `bot/goblin-events.ts#fireDrop`, `routes/loot-hoard.ts`, `routes/chat-users.ts` (positive adjustments), `routes/giveaway.ts#awardCoins` (covers `bot_coins` main, `bot_item` pouch-full fallback, bonus combos).
- `!loot` and manual `/loot-hoard/drop` pass `allowBuffs: false` when `lootDropsEnabled` is OFF or for streamer manual drops.
- `!redeem` (chat) and `POST /giveaway/:id/redeem` (dashboard) both gate on `coinRedemptionEnabled`.
- Random Goblin Events use in-memory `RECENT_CHATTERS` per channel — only fires after viewers have spoken since bot start. Steals silently skip when balance ≤ 0.
- **`rateLimit`** signature is `rateLimit(key, { max, windowMs })` — NOT positional args.

## Elimination Wheel (`components/elimination-wheel.tsx`)

**Wheel picks the winner organically** — server NO LONGER pre-picks. On "Start Eliminations", wheel runs `pickWeightedWinner(entries)` (weighted random by tickets, matches server's legacy fallback for unchanged odds), builds elimination order against everyone else. Last contender standing IS winner. Wheel reports via `onWinnerDecided(username)`; parent passes to `useEndGiveaway({ id, data: { winnerUsername } })`. `POST /giveaway/:id/end` accepts optional `winnerUsername`; validates it's in entries pool (400 if not). Body-less callers still get legacy weighted-random server-side. Each ticket gets its own slot card. 🔀 Shuffle reshuffles unprocessed tail. Modes: `manual` vs `auto` (`speedMs = {slow:1500, medium:900, fast:450}`). Final-two pause unconditional. RPG flavor banner (`flavorEnabled` ← `usersTable.eliminationFlavorEnabled`) renders themed lines from `components/elimination-flavors.ts`. Wheel settings live IN the modal via `WheelSettingsPopover` (⚙️), NOT on Forge page. **`flavorEnabled` is required** on props.

**Wheel props** — `entries`, `mode`, `speed`, `flavorEnabled` (required); `winner` (REPLAY ONLY — re-opening ended giveaways; live flow MUST omit so wheel picks organically); `onWinnerDecided(username)` (called exactly once per open the moment phase→`revealed`, guarded by `winnerReportedRef`); `recordingWinner` (cosmetic indicator while end-mutation is in flight). The `onDrawWinner`/`drawingWinner`/pre-fetched `winner` flow is REMOVED — do not reintroduce. Closing the modal before spin completes leaves giveaway active and never touches the server.

**Single phase-driven footer CTA** — ONE button; label/handler rotates with `phase`:
- `idle` → **Start Eliminations** (`handleStart` picks winner locally, builds elimination order, transitions to `spinning` after `setTimeout(50)` defer so React commits state before the spin loop reads it).
- `final-two` → **Start Final Battle** (rose; sets `phase="fight"`). Auto-pause 1.6s `useEffect` that previously transitioned final-two→fight is REMOVED — streamer drives manually.
- `revealed` → **Continue** (amber; calls `onClose`).
- `spinning` / `shuffling` / `fight` hide all CTAs so animations can't be re-fired.
Single-user giveaways (no `finalOpponent`) skip directly from spinning to `revealed`.

**Pixel-fight final spin** (`components/pixel-fight-scene.tsx`) — on Final Spin, modal renders ~5s CSS-pixel-sprite fight (face-off → exchange → loser falls → winner cheers). `prefers-reduced-motion` short-circuits to immediate `onDone`. After `onDone`, wheel re-invokes `revealWinner` via `setTimeout(50)` — **do not remove that micro-defer** or React batching will swallow the phase transition.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
