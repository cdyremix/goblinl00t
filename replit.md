# Goblin L00t

A mischievous goblin-themed Twitch bot + web dashboard for running giveaways, loot drops, and chaos commands in Twitch chat.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/goblin-dashboard run dev` — run the React dashboard (served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm run typecheck:libs` — rebuild composite lib declarations (run after DB schema changes)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + pino logger
- DB: PostgreSQL + Drizzle ORM (lib/db)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in lib/api-spec)
- Build: esbuild (CJS bundle)
- Frontend: React 18 + Vite, TailwindCSS v4, shadcn/ui, Wouter routing, React Query

## Where things live

- `lib/db/src/schema/` — DB schema (giveaways, giveaway_entries, loot_drops, command_logs, user_inventory, goblin_events, users)
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth for all endpoints
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `artifacts/api-server/src/` — Express API + bot service
  - `src/bot/bot-service.ts` — tmi.js Twitch bot (offline mode if no token)
  - `src/bot/loot-tables.ts` — rarity tiers and item pools (LOOT_TABLE export)
  - `src/bot/inventory.ts` — 5-slot inventory service: rollLootDrop (luck buff bumps rarity), addInventoryItem (per-user advisory lock), sellInventoryItem (coins-buff 2× multiplier in same txn), useInventoryItem, consumeBuffCharge, hasActiveBuff
  - `src/bot/goblin-events.ts` — 5–15 min jitter scheduler, picks random recent chatter, fires drop (loot_drops insert) or steal (point_redemptions kind='goblin_steal', capped to balance); gated by usersTable.goblinEventsEnabled
  - `src/routes/` — giveaway, loot, stats, commands, bot, inventory, settings routes
- `artifacts/goblin-dashboard/src/` — React frontend
  - `src/pages/` — home, dashboard, giveaways, giveaway-detail, stats, commands
  - `src/components/layout.tsx` — sidebar nav layout
  - `src/index.css` — dark goblin cave theme (gold/amber primary, purple epic, green uncommon)

## Architecture decisions

- OpenAPI-first: all endpoints defined in `lib/api-spec/openapi.yaml`; React Query hooks and Zod schemas auto-generated via Orval.
- Bot runs in offline mode (dashboard-only) when `TWITCH_OAUTH_TOKEN` env is not set — graceful degradation.
- `lib/db` is a composite lib; always run `pnpm run typecheck:libs` after schema changes before typechecking artifacts.
- Proxy routes at `/api` → api-server (port 8080), `/` → goblin-dashboard.
- Commands toggled via `/api/commands/:name/toggle` and cached in-memory in the bot service.

## Product

- **Home page** (`/`): Public landing page with feature overview and chat command reference.
- **Dashboard** (`/dashboard`): Bot status (online/offline), stats overview, active giveaway panel, live loot feed.
- **Loot Hoard** (`/giveaway`): Create giveaways, filter list by status, click through to detail.
- **Giveaway Detail** (`/giveaway/:id`): Start, end (pick winner), reroll. Shows winner banner and full entry list.
- **Ledger** (`/stats`): Top looters leaderboard with rarity bars, command usage chart.
- **Spells** (`/commands`): Toggle individual chat commands on/off with live cooldown display.
- **Forge** (`/settings`): Bot display name, theme picker (goblin/cs2), Economy & Loot toggles (Random Goblin Events, Special-Item Loot Drops, Coin Redemption, Coin Balance Cap), Elimination Wheel mode/speed, Steam trade URL, Steam ID 64 with CS2 inventory grid.
- **Trade Office** (`/trade-office`): Manage CS2 skin delivery to giveaway winners — track trade URLs, mark trade-locked items, add notes, update status (pending → sent).
- **Loot Hoard Quick Prize panel**: streamer-only manual drop (coins or random item) on `/giveaway` page, no giveaway needed. Items roll into the viewer's pouch via `addInventoryItem`; falls back to a coin credit equal to the item's value if the pouch is full.
- **Elimination Wheel**: when ending a giveaway, opens a modal that animates through entries and eliminates one per round until the server-chosen winner remains. Settings: `wheelMode` (auto/manual) and `wheelSpeed` (slow/medium/fast).

## Bot Commands

`!loot`, `!enter`, `!goblin`, `!steal`, `!hoard`, `!inventory`, `!sell <slot|all>`, `!use <slot>`, `!coins` (alias for `!points`), `!feedgoblin`, `!giveaway`, `!tradeurl`

## Twitch Integration

Bot requires three env vars to go live in chat:
- `TWITCH_OAUTH_TOKEN` — OAuth token for the bot account
- `TWITCH_BOT_USERNAME` — bot's Twitch username
- `TWITCH_CHANNEL` — channel name to join

Without them, the API and dashboard work fully; the bot just won't connect to Twitch.

## Gotchas

- Always run `pnpm run typecheck:libs` after editing `lib/db/src/schema/` before checking artifacts.
- Do not run `pnpm dev` at root — use workflows or `pnpm --filter` commands.
- The `getGiveawayEntries` endpoint does NOT have a `limit` query param (removed to avoid TS2308 collision with path param).
- `currentGiveaway.giveaway` can be null — always optional-chain as `currentGiveaway?.giveaway?.id`.
- `giveaway_entries` has a unique index on `(giveaway_id, username)` — always insert tickets via `onConflictDoUpdate` (see `bot/points.ts#redeemEntriesForUser`), never read-modify-write.
- All point-redemption flows MUST go through `redeemEntriesForUser()` (serializable transaction). Do not write `point_redemptions` + `giveaway_entries` directly from a route or bot handler.
- `POST /giveaway/:id/redeem` is Clerk-authed and operates on the caller's linked `usersTable.twitchUsername` — it cannot redeem for another user.
- Sub-tier detection reads `tags.badges?.subscriber` (only `"2000"` / `"3000"` indicate Tier 2 / 3; anything else is Tier 1). `badges-raw` and `badge-info` are NOT reliable for tier.
- Follower gating is best-effort and falls open when `TWITCH_CLIENT_ID` / `TWITCH_OAUTH_TOKEN` aren't set or the broadcaster has no stored `twitchUserId`. For strict enforcement, configure a real Twitch app token.
- Giveaway prizes have three kinds (`prizeKind`): `cs2` (manual streamer delivery via Trade Office), `bot_item` (auto-rolls into winner's inventory; falls back to coin credit if pouch is full), `bot_coins` (credits `prizeBotCoins` directly to the winner via `loot_drops`). Always serialize/deserialize all three new fields (`prizeKind`, `prizeBotCoins`, `prizeBotRarity`).
- Inventory is capped at 5 slots per (channel, username). All inserts MUST go through `addInventoryItem()` — it takes a per-user `pg_advisory_xact_lock` to enforce the cap under concurrency. The luck-buff charge consumption is atomic with the insert (pass `consumeLuckOnSuccess: true`); a "full" result never burns the charge.
- Ticket buff (`!enter`) is consumed only after the entry insert lands. The insert uses `onConflictDoNothing` on `(giveaway_id, username)` so a concurrent duplicate entry won't burn the buff either.
- New chat-driven inventory paths normalize username via `tags.username` (lowercase). Historical `loot_drops` / `point_redemptions` rows may be mixed-case, so balance lookups can split across casings until backfilled — known limitation, not a regression.
- `Random Goblin Events` (settings toggle, default ON) picks from an in-memory `RECENT_CHATTERS` map per channel, so it activates only after viewers have spoken since the bot started. Steals are silently skipped when balance ≤ 0; events are logged in `goblin_events`.
- Per-channel runtime settings (`lootDropsEnabled`, `coinRedemptionEnabled`, `coinCap`, `goblinEventsEnabled`, `wheelMode`, `wheelSpeed`) live on `usersTable` and are cached in-memory by `bot/channel-settings.ts`. The settings PUT handler MUST call `invalidateChannelSettings(twitchUsername)` after writing — the bot reads the cache on every chat command.
- `coinCap` is a **display clip**, not a hard write block: new earnings still write to `loot_drops`, but `getPointsBalance()` clamps the returned `balance` so `!coins`, the leaderboard, and redemption checks all honor the ceiling. `getPointsBalance()` now returns `{earned, redeemed, balance, cap}`; existing callers destructure only `{balance}` so adding `cap` is backwards-compatible.
- `!loot` and the manual `/loot-hoard/drop` route both pass `allowBuffs: false` to `rollLootDrop()` when `lootDropsEnabled` is OFF (or for streamer manual drops, since buffs would be confusing as a "Quick Prize"). Quick Prize items honor an optional rarity hint and re-pick from the matching tier of `LOOT_TABLE`.
- `!redeem` (chat) and `POST /giveaway/:id/redeem` (dashboard) both gate on `coinRedemptionEnabled` before reaching `redeemEntriesForUser()`. Disable both paths from a single toggle.
- Elimination wheel (`components/elimination-wheel.tsx`) is purely cosmetic: the server still picks the winner via `useEndGiveaway`. The modal pre-shuffles losers client-side and places the server's winner last. `wheelMode === "manual"` requires the streamer to click "Spin" between rounds; "auto" paces itself with `speedMs = {slow:1500, medium:900, fast:450}`. The "final two" phase always pauses for dramatic effect regardless of mode.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
