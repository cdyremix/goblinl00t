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

- `lib/db/src/schema/` — DB schema (giveaways, giveaway_entries, loot_drops, command_logs, user_inventory, goblin_events, users, giveaway_presets)
- `lib/api-spec/openapi.yaml` — source of truth; `lib/api-client-react/src/generated/` = auto-generated hooks (do not edit)
- `artifacts/api-server/src/`
  - `bot/bot-service.ts` — tmi.js bot (offline if no `TWITCH_OAUTH_TOKEN`)
  - `bot/loot-tables.ts` — `LOOT_TABLE`, themed pools (goblin/cs2)
  - `bot/inventory.ts` — 5-slot inventory, `addInventoryItem` (advisory lock), buffs
  - `bot/goblin-events.ts` — random drop/steal scheduler (5–15min jitter)
  - `bot/points.ts` — `redeemEntriesForUser`, `getPointsBalance`, `clampCoinAward`
  - `routes/` — giveaway, loot, stats, commands, bot, inventory, settings, chat-users, auth, steam, health
  - `lib/auth-helpers.ts` — `requireStreamerChannel` (strict, for writes), `resolveStreamerChannelForRead` (dev-fallback to `goblinl00t`), `rateLimit`
  - `lib/discord-webhook.ts` — fires winner embeds; host-allowlisted; never logs raw err
- `artifacts/goblin-dashboard/src/`
  - `pages/` — home, dashboard, giveaways (`/giveaway`), giveaway-detail, stats, commands, account, settings, trade-office, help, chat-users, pricing, terms, privacy
  - `components/layout.tsx` — sidebar (logo → user menu → nav → pinned Help) + footer (Help/Pricing/Discord/Terms/Privacy) + `<OnboardingTour />`
  - `components/onboarding-checklist.tsx` — dashboard checklist (Twitch link / Steam / first command / first giveaway)
  - `components/error-boundary.tsx` — wraps `<App>`; goblin-themed Reload card
  - `components/elimination-wheel.tsx` + `pixel-fight-scene.tsx` — see Elimination Wheel below

## Key DB Columns (on `usersTable`)

- `isAdmin` (bool, default false) — super-user flag. When true, server `userHasFeature()` short-circuits to true for every feature AND `requireAdmin` middleware lets the row owner hit `/api/admin/*`. Auto-set in `lib/get-or-create-user.ts` whenever Clerk's primary email matches `SUPER_USER_EMAILS` env (default `c.borawa@gmail.com`); first-time grant also bumps `subscriptionTier` → `"pro"` and flips `tierSelected` so the picker doesn't pop. Manual flips happen via `PATCH /api/admin/users/:id` (with self-demotion guard). Frontend `useSubscriptionTier()` exposes `isAdmin` and bypasses `hasFeature` checks accordingly; sidebar Admin Console link + `/admin` route both gate on it.
- `streamStartedAt` — **deprecated** (manual Start/End Stream removed). Read by `routes/stats.ts` (`range=stream`) and `routes/loot.ts` (`since=stream`); falls back to last 12h.
- `eliminationFlavorEnabled` (bool, default true) — RPG flavor banner in wheel modal (cosmetic, never reaches chat). Toggled in modal's ⚙️ popover.
- `tierSelected` (bool, default false) — flips true the first time the streamer picks a rank in the post-signup `<TierSelectModal>` (mounted in `components/layout.tsx`). Both `PUT /users/me/subscription` and `PUT /users/me/tier-acknowledge` set it. Free is a valid choice. Modal is non-dismissible and re-opens on every dashboard load while false.
- `commandResponses` (jsonb) — per-channel `{"!cmd": "template"}`. Cached by `bot/command-responses.ts`; **all writes must call `invalidateCommandResponses(channel)`**. Tokens via `renderTemplate` (`{user}`, `{balance}`, `{commands}`, `{theme}`).
- `commandToggles` (jsonb) — per-channel `{"!cmd": boolean}` overrides for built-in commands (canonical names; aliases share the canonical's flag). Absent key → use built-in default (currently `true` for every shipped command). Cached by `bot/command-toggles.ts`; **all writes must call `invalidateCommandToggles(channel)`**. Read at request time via `getToggleFor(channel, canonical, true)` from the bot chat handler. Replaces the old module-global `COMMAND_ENABLED` map (which leaked toggle state across every streamer).
- `discordWebhookUrl` — fired on giveaway end (see Security).
- Channel runtime settings (`lootDropsEnabled`, `coinRedemptionEnabled`, `coinCap`, `goblinEventsEnabled`, `wheelMode`, `wheelSpeed`) — cached by `bot/channel-settings.ts`; settings PUT MUST call `invalidateChannelSettings(twitchUsername)`.
- `steamTradeUrl` — auto-populated when streamer connects Steam (manual input removed; bot uses winner trade URLs from `tradeFulfillmentsTable.steamTradeUrl` collected via `!tradeurl`).

## Product Surfaces

- **Home** (`/`) — public landing.
- **Dashboard / Operations** (`/dashboard`) — Overview tab (bot status, stats, **Recent Winners**, live loot feed; scoped to stream window) + Chat Users tab. Mounts `OnboardingChecklist` at top.
- **Loot Horde** (`/giveaway`) — hero `SpotlightCard` (Pending → Start, Active → 🎡 Spin Wheel inline) + create form + Quick Prize Drop + filterable list. Per-row delete uses shadcn `AlertDialog`. 🧪 **Create Test Giveaway** (page header) and **+ Test** (when entries < 5) call dev-gated seed routes (`POST /giveaway/seed-test`, `POST /giveaway/:id/seed-entries`); both share `FAKE_VIEWERS` in `routes/giveaway.ts`. Page title says "Loot Horde" but route/API/chat names kept original "Hoard" spelling.
- **Giveaway Detail** (`/giveaway/:id`) — Start, end (opens wheel; the actual server end-call is deferred to the wheel's "Draw Winner!" button so closing the modal doesn't auto-end), restart (re-opens an ended giveaway, preserves entries, clears winner), inline manual entry add + per-row delete (only while not-ended).
- **Ledger** (`/stats`) — Day/Week/Month/Year/All tabs. Engagement Tips card via `GET /stats/engagement`. CSV export (channel-scoped) via `/stats/export?range=&kind=loot|commands|giveaways`.
- **Spells** (`/commands`) — toggle commands; live cooldowns; inline custom-response editor for `customizable: true` commands.
- **Forge** (`/settings`) — bot name, theme picker (goblin/cs2), Economy & Loot toggles, Discord webhook URL, Steam connection + CS2 inventory grid.
- **Trade Office** (`/trade-office`) — manage CS2 skin delivery (trade URLs, locked items, status pending → sent).
- **Chat Users** (`/users`) — every viewer who's earned/redeemed coins or held inventory; Adjust Coins dialog.
- **Admin Console** (`/admin`) — super-user only (gated by `AdminRoute` + server `requireAdmin`). Roster of every registered streamer with stat cards (total / Twitch-linked / Premium / Pro), inline Edit + Delete per row.
  - **Create user** (page header) — `POST /admin/users` body `{email, password (≥8), twitchUsername?, subscriptionTier?, isAdmin?}`. Provisions a Clerk user (`clerkClient.users.createUser({emailAddress:[email], password})`) THEN inserts the matching `usersTable` row with `tierSelected:true` (skips the post-signup tier modal). On any failure AFTER the Clerk create succeeds, the route compensating-deletes the orphaned Clerk user. Pre-flight 409 if `twitchUsername` collides with an existing row. The new account can sign in immediately with the supplied creds; bot binding still requires the streamer to complete Twitch OAuth from `/account` (so `twitchUserId` gets set).
  - **Edit dialog** (tabs: Identity / Subscription / Billing / Danger).
    - *Identity*: PATCH `twitchUsername` (lowercased) / `steamUsername` via `/admin/users/:id`; POST email change via `/admin/users/:id/email` (Clerk `emailAddresses.createEmailAddress` w/ `verified+primary`, sweeps old non-primary addrs); POST temp password via `/admin/users/:id/password` (Clerk `users.updateUser({password, signOutOfOtherSessions: true})`).
    - *Subscription*: tier + `isAdmin` PATCH (manual entitlement override — re-overwritten on next `/stripe/subscription` read if user has an active sub); plus an immediate `POST /admin/users/:id/subscription/cancel` that calls `stripe.subscriptions.cancel` and clears the local `stripeSubscriptionId`/tier.
    - *Billing*: `GET /admin/users/:id/invoices` joins `stripe.invoices LEFT JOIN stripe.charges` so each row knows its `chargeId` + `amountRefunded`; per-row Refund button posts `/admin/users/:id/refund` (full refund, `requested_by_customer`). Server VERIFIES the chargeId belongs to the user's `stripeCustomerId` before issuing — never trust dashboard-supplied chargeIds.
    - *Danger*: `DELETE /admin/users/:id` cascade order = (1) cancel Stripe sub if any, (2) `clerkClient.users.deleteUser`, (3) DB delete (FK cascades wipe `custom_commands` + `giveaway_presets`; channel-scoped chat history rows like `loot_drops`/`point_redemptions`/`user_inventory` are intentionally left orphaned for Ledger continuity). Refuses to delete/demote self.
  - Sidebar link only renders when `useSubscriptionTier().isAdmin` is true.
- **Help & Guide** (`/help`) — static reference + chat command table.
- **Terms / Privacy** (`/terms`, `/privacy`) — public; no API calls.
- **Pricing** lives on the public homepage as a `#pricing` anchor section (NOT a separate route). `/pricing` is a `<Redirect>` to `/#pricing` for back-compat. Tier copy is sourced from `lib/plans.tsx` so the homepage section, the post-signup `<TierSelectModal>`, and `/account` Rank tab stay in sync — edit in one place.

## Stripe Subscriptions

Real recurring billing via the Replit Stripe connector. The user's Stripe account is the source of truth — we never write to the `stripe.*` schema (managed by `stripe-replit-sync`).

- **Setup**: `artifacts/api-server/src/lib/stripeClient.ts` lazily inits a Stripe SDK client + a `StripeSync` instance. Secret key + connector account id are pulled from the connector at request time (cached). API version pinned to `2026-04-22.dahlia` (must match in `scripts/src/lib/stripeClient.ts` too).
- **Boot sequence** (`index.ts`, gated, never crashes the server):
  1. `runMigrations()` once to create the `stripe.*` schema.
  2. `findOrCreateManagedWebhook(<https://${REPLIT_DOMAINS[0]}/api/stripe/webhook>)` registers the webhook on the connector's Stripe account.
  3. `sync.syncBackfill({ object: "all" })` — **must pass `object: "all"`**; without it the package's switch falls through and silently no-ops, leaving `stripe.products`/`stripe.prices` empty and `/api/stripe/prices` returning `{}`.
- **Webhook**: `/api/stripe/webhook` is mounted with `express.raw({ type: "application/json" })` BEFORE `express.json()` in `app.ts` so signature verification sees the raw bytes. Don't reorder.
- **esbuild**: `stripe-replit-sync` is **externalized** in `artifacts/api-server/build.mjs` — its migrations resolve via `__dirname` and break when bundled.
- **Tier mapping**: each Stripe Product carries `metadata.tier ∈ {"premium","pro"}` (set by `scripts/seed-products.ts`). `routes/stripe.ts#GET /subscription` reconciles `usersTable.subscriptionTier` from the active sub's product metadata on every read, so no extra webhook handler is needed for tier sync.
- **Routes** (all Clerk-authed, NO `requireStreamerChannel` so users can subscribe pre-Twitch-link):
  - `GET /stripe/prices` — public-ish; lists active monthly prices keyed by tier.
  - `POST /stripe/checkout` — creates/reuses `usersTable.stripeCustomerId`, returns Checkout Session URL. **Pro-ration path**: when the caller already has an `active`/`trialing`/`past_due` `stripeSubscriptionId` AND the requested tier maps to a different `priceId`, the route calls `stripe.subscriptions.update(items: [{id, price}], proration_behavior: 'always_invoice', payment_behavior: 'default_incomplete')` instead of opening Checkout — Stripe immediately invoices the prorated delta against the saved payment method. The DB `subscriptionTier` is optimistically set so the UI reflects the new rank without waiting for a webhook (the next `GET /stripe/subscription` reconciles from Stripe truth either way). Same-tier requests on an active sub redirect to the Billing Portal (`{alreadyOnTier: true}`). Any error in the upgrade probe falls back to a fresh Checkout session.
  - `POST /stripe/portal` — Billing Portal session for an existing customer.
  - `GET /stripe/subscription` — current sub + reconciles tier.
  - `POST /stripe/subscription/cancel-at-period-end` (toggle) / `POST /stripe/subscription/cancel-now`.
  - `GET /stripe/invoices?status=&from=&to=` — billing history (channel-scoped to the caller's customer).
- **Frontend**:
  - `tier-select-modal.tsx`: free → `/users/me/subscription`; paid → `/api/stripe/checkout` redirect.
  - `account.tsx` Rank tab: subscription mutation routes existing-sub → portal, new-sub → checkout. Upgrade/Switch label derived via `TIER_RANK` from `lib/plans.tsx`.
  - `billing-section.tsx`: subscription status card (badge, period end, portal button, auto-renew Switch, cancel-now AlertDialog) + filterable invoice table.
- **Re-seed prices**: `pnpm --filter @workspace/scripts run seed-products` (idempotent — looks up existing products by `metadata.tier`).

## Bot Commands

Canonicals (Spells page lists only these; aliases share toggle/cooldown/handler):
- `!loot`, `!enter`, `!inventory`, `!sell <slot|all>`, `!use <slot>`, `!giveaway`, `!redeem`, `!tradeurl`
- `!help` (customizable; tokens `{user}` `{commands}` `{theme}`)
- `!points` / `!coins` (customizable; `{user}` `{balance}`)
- `!hoard` / `!stash` (customizable; `{user}` `{balance}`)
- `!goblin` / `!skin` (customizable; `{user}` `{theme}`)
- `!feedgoblin` / `!case` (customizable; `{user}` `{theme}`)
- `!steal` / `!scam`

Aliases declared via `BUILT_IN_COMMANDS[name].aliasOf`; `getCommandConfig()` filters them out and emits `aliases[]` on the canonical. `toggleCommandEnabled()` propagates state to all aliases. **To add a customizable command**: tag `customizable: true`, `availableTokens`, `defaultResponse`; swap handler to `renderTemplate(getCustomResponseFor(channel, name) ?? DEFAULT, vars)`; document tokens in this README.

## Twitch Integration

Bot needs three env vars to go live: `TWITCH_OAUTH_TOKEN`, `TWITCH_BOT_USERNAME`, `TWITCH_CHANNEL`. Without them the API/dashboard work fully — bot just stays offline.

## Streamer Account Linking (OAuth)

- **Twitch sign-in** (`routes/auth.ts`) — real Twitch OAuth. Frontend (`pages/account.tsx#startTwitchConnect`) calls `GET /api/auth/twitch` via authed fetch, server returns `{url}`, browser does `window.location.assign(url)`. **Do NOT** convert this to a top-level `<a href>` — Clerk's session cookie isn't reliably sent to the API origin under the proxy. Callback redirects to `/account?tab=channel&connected=twitch`. State is HMAC-SHA256 signed (keyed on `SESSION_SECRET`); callback constant-time verifies before exchanging code. Init endpoint rate-limited to 10/min per Clerk user. Requires `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`.
- **Steam sign-in** (`routes/steam.ts`) — real Steam OpenID 2.0. Frontend posts to `/api/steam/auth/init`, server sets signed `steam_oauth_clerk` cookie (HMAC, 10-min TTL, httpOnly/secure/sameSite=lax) and returns `{url}`. Callback verifies via `mode=check_authentication`, parses SteamID64 from `openid.claimed_id`, fetches profile name via `steamcommunity.com/profiles/<id>/?xml=1` (no API key), writes `steamId64` + `steamUsername` + `steamTradeUrl`, redirects to `/settings?connected=steam`. Init endpoint rate-limited. `MOCK_STEAM_ID64` short-circuit still honored by `/steam/inventory` for dev.
- **Account page tab** (`pages/account.tsx`) — `Tabs defaultValue` reads `?tab=identity|channel|rank` once on mount.

## Security & Multi-Tenancy

- **`requireAdmin(req, res)`** — strict super-user gate; 401 unauthed, 403 if `usersTable.isAdmin` is false. Use for ALL `/admin/*` routes (`routes/admin.ts`). Returns `{ user }` (full row) so handlers can self-reference. Never trust the dashboard `isAdmin` flag alone — every admin endpoint MUST start with `requireAdmin`.
- **`requireStreamerChannel(req, res)`** — strict; 401 if unauthed, 403 if Twitch not linked. Use for ALL mutations.
- **`resolveStreamerChannelForRead(req, res)`** — read-only convenience: in `NODE_ENV !== "production"` falls back to `"goblinl00t"` for unlinked accounts so the dashboard isn't a 403 wall during onboarding/dev. Production behaves identically to `requireStreamerChannel`. Use for GET routes that should show *something* before linking; **NEVER** for writes.
- **Giveaway routes are channel-scoped**: GETs (`/giveaway`, `/current`, `/:id`, `/:id/entries`) use `resolveStreamerChannelForRead` and filter by `ctx.channel`; cross-channel `:id` returns 404 (don't leak existence). POST `/giveaway` uses `requireStreamerChannel` and ignores body-supplied `channel`. Mutations (start/end/reroll/delete) verify ownership against `existing.channel`. The unlinked-`goblinl00t` exception in mutations is gated to `NODE_ENV !== "production"` (dev seed-flow convenience only).
- **Stats CSV export** is `requireStreamerChannel`-scoped and filters by `ctx.channel`. Other `/stats/*` aggregates remain global by design (legacy single-tenant Ledger view) — scope them too if you ever expose multi-tenant Ledger.
- **Discord webhook** (`lib/discord-webhook.ts`) — host-allowlisted (`discord.com` / `discordapp.com`); `catch` logs only `errName` + `errMessage` + `channel` (never raw `err` — fetch errors can leak the secret URL). Settings UI regex matches the server-side allowlist.
- **Health endpoints** — `/api/healthz` (always 200) and `/api/readyz` (db ping) for uptime monitors.

## Maintenance Mode

Public-facing launch wall. Primary toggle is a Switch in the **Admin Console → Maintenance Mode** card (calls `PUT /admin/maintenance`, persists to the `app_settings` singleton row). The `MAINTENANCE_MODE` env var still works as an override — when truthy it forces ON regardless of the DB row and the admin Switch is locked + annotated. State source of truth lives in `lib/maintenance-state.ts` (5s in-memory cache, busted on `setMaintenanceEnabled`).

- `GET /api/maintenance/status` (public; reads optional Clerk session) → `{ enabled, isAdmin }`. `isAdmin` is server-resolved from `usersTable.isAdmin`, never trusted from the client.
- `POST /api/waitlist` (public; rate-limited 5/min/IP) — body `{ email, source? }`, idempotent on email via `onConflictDoNothing`. Always returns `{ ok: true }` on success so probes can't enumerate the list. Stored in `waitlist_emails` (id, email unique, source, createdAt).
- Server-side enforcement via `lib/maintenance-guard.ts` (mounted at `/api` AFTER `clerkMiddleware`). When ON, every `/api/*` request returns `503 {error, maintenance:true}` EXCEPT: (a) the allowlist `maintenance/status`, `waitlist`, `healthz`, `readyz`, `users/me`, and `auth/*` (Twitch OAuth round-trip); (b) authenticated callers whose `usersTable.isAdmin === true`. Stripe webhook is pre-mounted before the guard so payment events keep landing. `/sign-up`, `/stripe/checkout`, etc. are deliberately NOT allowlisted — closed beta during maintenance.
- Frontend `<MaintenanceGate>` (`components/maintenance-gate.tsx`) wraps `<AppRouter />` inside the Clerk + QueryClient providers. Behavior: status off → pass-through; status loading → neutral splash (no flash of app); status query errored → **fail closed** (renders the wall, since the API is unreachable); status on + admin → slim amber banner + full app; status on + non-admin → full-screen modal with notify-me form + Dev Login link to `/sign-in`. Allowed-through paths (`/sign-in`, `/terms`, `/privacy`) render normally so admins can authenticate and the legal footer keeps working. Status refetches every 60s + on focus so an admin demotion / mode flip propagates.
- Admin endpoints: `GET /admin/maintenance` → `{ enabled, envOverride }`; `PUT /admin/maintenance` body `{ enabled: bool }` (returns `{ enabled, envOverride }`, also invalidates the public status query). Both gated by `requireAdmin`.
- To toggle: flip the Switch in **Admin Console → Maintenance Mode**, OR set `MAINTENANCE_MODE=true` env (overrides DB) and unset to release. Cache is 5s so a flip propagates within a few seconds across processes.

## Important Gotchas

- `pnpm run typecheck:libs` after editing `lib/db/src/schema/` before checking artifacts.
- Don't run `pnpm dev` at root — use workflows or `pnpm --filter`.
- `getGiveawayEntries` does NOT have a `limit` query param (TS2308 collision with path param).
- `currentGiveaway.giveaway` can be null — always `currentGiveaway?.giveaway?.id`.
- `giveaway_entries` has unique `(giveaway_id, username)` — always insert via `onConflictDoUpdate` (see `bot/points.ts#redeemEntriesForUser`); never read-modify-write.
- ALL point-redemption flows MUST go through `redeemEntriesForUser()` (serializable txn). Do not write `point_redemptions` + `giveaway_entries` directly.
- `POST /giveaway/:id/redeem` is Clerk-authed and operates on caller's linked `twitchUsername` only.
- Sub-tier detection: `tags.badges?.subscriber` (`"2000"` / `"3000"` = T2/T3, anything else = T1). `badges-raw` and `badge-info` are NOT reliable.
- Follower gating is best-effort; falls open without `TWITCH_CLIENT_ID` / `TWITCH_OAUTH_TOKEN` or stored `twitchUserId`.
- **`prizeKind`** has three values: `cs2` (manual delivery via Trade Office), `bot_item` (auto-rolls into pouch; falls back to coin credit if full), `bot_coins` (direct credit via `loot_drops`). Always serialize all three fields (`prizeKind`, `prizeBotCoins`, `prizeBotRarity`). **Combo prizes**: `prizeBotCoins` carries through for ALL kinds — main reward for `bot_coins`, optional bonus on top for `cs2`/`bot_item` (separate `loot_drops` row labeled `"Giveaway Bonus: <title>"`). `prizeBotRarity` biases the `bot_item` roll, cosmetic on `cs2`.
- **Theme threading**: `rollLootDrop` filters `LOOT_TABLE` by `opts.theme`; **all call sites must pass it** (`bot-service.ts !loot`, `routes/giveaway.ts bot_item` use `getActiveTheme()`; `routes/loot-hoard.ts` reads `user.botTheme`). Forgetting silently defaults to goblin items even on CS2 channels.
- **Inventory cap** is 5 slots per (channel, username). All inserts MUST go through `addInventoryItem()` (per-user `pg_advisory_xact_lock`). Luck-buff consumption is atomic via `consumeLuckOnSuccess: true`; "full" never burns the charge. Ticket buff (`!enter`) consumed only after entry insert lands.
- **Username casing**: chat inserts normalize via `tags.username.toLowerCase()`. Historical mixed-case rows in `loot_drops` / `point_redemptions` / `user_inventory` were backfilled to lowercase once — should not need to repeat.
- **`getPointsBalance(username, channel?)`** — channel is **optional** but should be passed everywhere we know it. All bot chat handlers (`!points`/`!coins`, `!hoard`/`!stash`), `goblin-events.fireSteal`, `routes/points.ts /points/me`, `routes/inventory.ts`, and `routes/chat-users.ts` all pass channel. Only legacy leaderboard-style aggregations may omit it. The cap is per-streamer-row and only resolves when channel is supplied.
- **Multi-tenant scoping** — these surfaces are channel-scoped via `resolveStreamerChannelForRead` / `requireStreamerChannel` and MUST stay that way: `routes/stats.ts` (overview, commands, top-looters, engagement, export), `routes/inventory.ts` (me/sell/use — channel == caller's twitchUsername; the legacy `defaultChannel()` env-var fallback was removed), `routes/giveaway.ts` (all GETs and mutations). Bot chat handlers `!enter` / `!redeem` / `!giveaway` filter the active-giveaway lookup by `giveawaysTable.channel == chat channel` so concurrent tenants don't bind to each other's giveaway. `redeemEntriesForUser` filters BOTH the balance read AND the redemption insert by `giveaway.channel` — coins earned in channel A cannot be spent into channel B's giveaway (this is a tenancy boundary, not just a UX nicety).
- **Multi-channel bot join layer** — the bot now multi-joins. `bot/bot-service.ts#loadJoinableChannels` queries every linked `usersTable.twitchUsername` (∪ `TWITCH_CHANNEL` env ∪ `goblinl00t` fallback), dedupes lowercase, and passes the full list to `tmi.Client({channels})`. `BotState.channels` exposes the live join list; legacy `BotState.channel` is kept as the primary/env channel for back-compat. Dynamic `joinChannel(name)` / `partChannel(name)` exports keep membership in sync without a restart: `routes/auth.ts` Twitch-link callback calls `joinChannel(twitchUser.login)`; `routes/admin.ts` user delete calls `partChannel(user.twitchUsername)`; admin PATCH that changes `twitchUsername` parts the old channel and joins the new (and triggers `reloadCustomCommands()` because the custom-command cache is keyed on twitchUsername). Twitch-link callback ALSO calls `reloadCustomCommands()` so commands a streamer created pre-link start firing immediately.
- **Per-channel theme** — `bot/channel-theme.ts` provides `getChannelTheme(channel)` / `getChannelThemePhrases(channel)` / `invalidateChannelTheme(channel)` (mirrors `channel-settings.ts` cache pattern, reads `usersTable.botTheme` by `twitchUsername`). Bot chat handler resolves the theme ONCE per message into `channelTheme` and threads it into every theme-branched site (`!loot`, `!help`, response phrases via `getChannelThemePhrases(channelKey)`); `announceGiveawayStart` / `announceGiveawayEnd` use `getChannelThemePhrases(giveaway.channel)`; `routes/giveaway.ts` bot-item award uses `await getChannelTheme(giveaway.channel)`. Settings PUT MUST call `invalidateChannelTheme(twitchUsername)` after writing `botTheme`. Replaces the module-global `setActiveTheme`/`getActiveTheme` in `bot/bot-themes.ts` (still present but no longer used by chat — only `THEMES`/`THEME_META`/`BotTheme` are imported now).
- **Built-in toggle write race** — `POST /commands/:name/toggle` does a snapshot read-modify-write on `usersTable.commandToggles`. Two near-simultaneous toggles on the same channel can lose one update (JSONB last-write-wins). Single-tenant in scope (one streamer toggling their own row), so not a tenancy bug. If it ever matters, switch to `jsonb_set(...)` in the UPDATE.
- **`coinCap`** is a HARD per-channel limit. `clampCoinAward(channel, username, requested)` (and `clampCoinAwardTx`) reads the **streamer's** `usersTable.coinCap` (looked up by `twitchUsername == channel`, NOT the viewer's row). EVERY coin-credit insert MUST go through it: `bot/inventory.ts#sellInventoryItem` (uses `clampCoinAwardTx` via dynamic import for circular-load avoidance), `bot/goblin-events.ts#fireDrop`, `routes/loot-hoard.ts`, `routes/chat-users.ts` (positive adjustments), `routes/giveaway.ts#awardCoins` (covers `bot_coins` main, `bot_item` pouch-full fallback, and bonus combos). `getPointsBalance` only resolves a non-null `cap` when `channel` is supplied; the WRITE path is the source of truth either way.
- `!loot` and manual `/loot-hoard/drop` pass `allowBuffs: false` when `lootDropsEnabled` is OFF or for streamer manual drops.
- `!redeem` (chat) and `POST /giveaway/:id/redeem` (dashboard) both gate on `coinRedemptionEnabled`.
- Random Goblin Events use in-memory `RECENT_CHATTERS` per channel — only fires after viewers have spoken since bot start. Steals silently skipped when balance ≤ 0.

## Elimination Wheel (`components/elimination-wheel.tsx`)

**Wheel picks the winner organically** — the server NO LONGER pre-picks. When the streamer clicks "Start Eliminations", the wheel itself runs `pickWeightedWinner(entries)` (weighted random by tickets, matching the server's legacy fallback for unchanged odds), then builds an elimination order against everyone else. The last contender standing IS the winner. The wheel reports them via `onWinnerDecided(username)`, which the parent passes to `useEndGiveaway({ id, data: { winnerUsername } })`. The server (`POST /giveaway/:id/end`) accepts an optional `EndGiveawayRequest.winnerUsername`; if supplied it validates the name is in the entries pool (400 if not) before recording. Body-less callers (any future automated path) still get the legacy weighted-random server-side. Each ticket gets its own slot card (viewers with more tickets get more board real estate). 🔀 **Shuffle** reshuffles the unprocessed tail. Modes: `manual` (streamer clicks Spin between rounds) vs `auto` (`speedMs = {slow:1500, medium:900, fast:450}`). Final-two pause is unconditional. RPG flavor banner (`flavorEnabled` ← `usersTable.eliminationFlavorEnabled`) renders themed lines from `components/elimination-flavors.ts`; banner color shifts purple → rose → amber across spinning / final-two / revealed. Wheel settings (mode/speed/flavor) live IN the modal via `WheelSettingsPopover` (⚙️ in header), NOT on the Forge page. **`flavorEnabled` is required** on `EliminationWheel` props — every caller passes it from `useGetBotSettings`.

**Wheel props** — `entries`, `mode`, `speed`, `flavorEnabled` (required); `winner` (optional, REPLAY ONLY — for re-opening already-ended giveaways; in the live flow MUST be omitted so the wheel picks organically); `onWinnerDecided(username)` (called exactly once per open the moment phase→`revealed`, guarded by `winnerReportedRef`); `recordingWinner` (cosmetic indicator while parent's end-mutation is in flight). The `onDrawWinner` / `drawingWinner` / pre-fetched `winner` flow is REMOVED — do not reintroduce. Closing the modal (X / overlay) before the spin completes leaves the giveaway active and never touches the server.

**Single phase-driven footer CTA** — the wheel exposes ONE button in the footer; its label/handler rotates with `phase`:
- `idle` → **Start Eliminations** (calls `handleStart`, which picks the winner locally via `pickWeightedWinner(entries)`, builds the elimination order, then transitions to `spinning` after a `setTimeout(50)` defer so React commits state before the spin loop reads it).
- `final-two` → **Start Final Battle** (rose; sets `phase="fight"`). The auto-pause 1.6s `useEffect` that previously transitioned final-two→fight is REMOVED — the streamer drives that transition manually.
- `revealed` → **Continue** (amber; calls `onClose`). The reveal overlay no longer renders its own duplicate Continue button.
- `spinning` / `shuffling` / `fight` phases hide all CTAs so animations can't be re-fired.
Single-user giveaways (no `finalOpponent`) skip directly from spinning to `revealed`, so the footer Continue is reachable in that path too.

**Pixel-fight final spin** (`components/pixel-fight-scene.tsx`) — when `phase === "final-two"` and the streamer hits **Final Spin**, the modal renders a ~5s CSS-pixel-sprite fight (face-off → exchange → loser falls → winner cheers). `prefers-reduced-motion` short-circuits to immediate `onDone`. After `onDone` the wheel re-invokes `revealWinner` via `setTimeout(50)` — **do not remove that micro-defer** or React batching will swallow the phase transition.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
