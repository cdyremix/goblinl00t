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

- `lib/db/src/schema/` — DB schema (giveaways, giveaway_entries, loot_drops, command_logs, user_inventory, goblin_events, users, giveaway_presets)
  - `usersTable.streamStartedAt` (nullable timestamp) — **deprecated** (the manual Start/End Stream UI was removed). Still read by `routes/stats.ts` (range=stream) and `routes/loot.ts` (since=stream) when present; falls back to the last 12h otherwise. Safe to ignore from new code.
  - `usersTable.eliminationFlavorEnabled` (boolean, default true) — when true, the elimination wheel modal renders an RPG-style flavor banner on each elimination (e.g. "@user was struck by a goblin's club!"). Purely cosmetic — never reaches Twitch chat. Toggled from the ⚙️ gear popover inside the wheel modal itself, not the Forge page.
  - `usersTable.commandResponses` (jsonb, default `{}`) — per-channel custom reply templates keyed by canonical command name (e.g. `{"!help": "...", "!hoard": "..."}`). Empty string clears. Cached by `bot/command-responses.ts`; **all writes must call `invalidateCommandResponses(channel)`**. Tokens are rendered by `renderTemplate(template, vars)` (e.g. `{user}` → `@username`, `{balance}`, `{commands}`, `{theme}`).
  - `giveaway_presets` — saved giveaway templates per streamer (title, description, prize, prizeKind, prizeBotCoins, prizeBotRarity, keyword, requireFollower, subscriberOnly, minSubTier).
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth for all endpoints
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `artifacts/api-server/src/` — Express API + bot service
  - `src/bot/bot-service.ts` — tmi.js Twitch bot (offline mode if no token)
  - `src/bot/loot-tables.ts` — rarity tiers + item pools (LOOT_TABLE). Each item has a `theme: "goblin" | "cs2"` field; `rollLootDrop` filters the pool by active theme (passed via `opts.theme`) with a fallback to any-theme pool if a tier is empty. **All call sites must thread the active theme**: `bot-service.ts` (`!loot`) and `routes/giveaway.ts` (`bot_item` award) use `getActiveTheme()`; `routes/loot-hoard.ts` (manual Quick Prize) reads `user.botTheme`. Forgetting the `theme` option silently defaults to "goblin" — CS2 streamers will get goblin items.
  - `src/bot/inventory.ts` — 5-slot inventory service: rollLootDrop (luck buff bumps rarity), addInventoryItem (per-user advisory lock), sellInventoryItem (coins-buff 2× multiplier in same txn), useInventoryItem, consumeBuffCharge, hasActiveBuff
  - `src/bot/goblin-events.ts` — 5–15 min jitter scheduler, picks random recent chatter, fires drop (loot_drops insert) or steal (point_redemptions kind='goblin_steal', capped to balance); gated by usersTable.goblinEventsEnabled
  - `src/routes/` — giveaway, loot, stats, commands, bot, inventory, settings, chat-users routes
  - `src/routes/chat-users.ts` — `GET /chat-users` aggregates every distinct username from `loot_drops`, `point_redemptions`, and `user_inventory` for the streamer's channel and returns `{username, coins, inventoryCount, inventory[]}`. The `inventory[].slot` is **synthesized** (1-based index over rows sorted by `id`) because `user_inventory` has no `slot` column. `POST /chat-users/:username/coins {delta, reason?}` writes positive deltas as a `loot_drops` row (`item: "Streamer Adjustment[: <reason>]"`, rarity epic, points = delta) and negative deltas as a `point_redemptions` row (`kind: "streamer_adjustment"`, `points: |delta|`, `ticketsAdded: 0`). Both flow through `getPointsBalance()` so the leaderboard, `!coins`, and the coin-cap clip remain consistent.
- `artifacts/goblin-dashboard/src/` — React frontend
  - `src/pages/` — home, dashboard, giveaways, giveaway-detail, stats, commands, account, settings, trade-office, help, chat-users
  - `src/components/layout.tsx` — sidebar layout: brand logo → expandable user menu (Collapsible: Account Settings + Sign Out) → main nav (Operations, Chat Users, Loot Hoard, Ledger, Forge, Trade Office) → pinned Help & Guide link at the bottom (separated by a top border). Mounts `<OnboardingTour />` on every authed page. The user menu auto-opens when on `/account`.
  - `src/components/onboarding-tour.tsx` — first-visit 4-step welcome modal (paginated dots + Skip/Next/Got it). Dismissal persists in localStorage as `goblin-loot-onboarded:<clerkUserId>` so it never replays for the same account on the same browser. Clear that key to force the tour to reappear during testing.
  - `src/index.css` — dark goblin cave theme (gold/amber primary, purple epic, green uncommon)

## Architecture decisions

- OpenAPI-first: all endpoints defined in `lib/api-spec/openapi.yaml`; React Query hooks and Zod schemas auto-generated via Orval.
- Bot runs in offline mode (dashboard-only) when `TWITCH_OAUTH_TOKEN` env is not set — graceful degradation.
- `lib/db` is a composite lib; always run `pnpm run typecheck:libs` after schema changes before typechecking artifacts.
- Proxy routes at `/api` → api-server (port 8080), `/` → goblin-dashboard.
- Commands toggled via `/api/commands/:name/toggle` and cached in-memory in the bot service.

## Product

- **Home page** (`/`): Public landing page with feature overview and chat command reference.
- **Dashboard / Operations** (`/dashboard`): Two tabs — **Overview** (bot status, stats, **Recent Winners** hall of fame, live loot feed, scoped to the current stream window) and **Chat Users** (full coin/inventory roster, formerly `/users`). Stats and the live loot feed pass `range=stream` / `since=stream`, which the API resolves to `usersTable.streamStartedAt` if present, else the last 12 hours. The Start/End Stream control was removed — the panel passively shows the stream window with a banner. The "Current Hoard" / active-giveaway card was removed because it duplicated the Loot Hoard SpotlightCard; in its place is a **Recent Winners** card that lists the last 5 ended giveaways with their winner + prize (each row deep-links to the giveaway detail page). The standalone `/users` route still works for deep links.
- **Loot Hoard** (`/giveaway`): Hero-led redesign so the streamer never has to bounce into a detail page just to draw a winner. **`SpotlightCard`** at the top features the live giveaway (or, if none, the most recent pending) with the primary action front-and-center — Pending → Start, Active → 🎡 Spin Wheel (opens the `EliminationWheel` modal **inline**, no navigation). When entries < 5, both the spotlight and each list row expose a dashed-border **+ Test** button that calls `POST /giveaway/:id/seed-entries` (idempotent: bulk-inserts 30 fake viewers via `onConflictDoNothing` on the (giveawayId, username) unique index). The `useSeedTestGiveaway` (`POST /giveaway/seed-test`) hook still creates a fresh test giveaway from scratch; both routes share a module-scope `FAKE_VIEWERS` constant in `routes/giveaway.ts`. Below the hero: the create form (left col) + a collapsed **Quick Prize Drop** panel + filterable list of `GiveawayRow` cards with inline Start / + Test / 🗑️ Delete buttons (the trash icon calls `useDeleteGiveaway` → `DELETE /giveaway/:id`, which cascades the entry + trade-fulfillment rows; it does NOT claw back coins already credited to a winner). The Saved Presets panel + Save Preset button were **removed** in the latest pass — streamers asked to drop it because the create form is fast enough on its own. The `giveaway_presets` table and `/giveaway-presets` routes still exist for back-compat with any pre-existing rows but no UI surfaces them.
- **Giveaway Detail** (`/giveaway/:id`): Start, end (pick winner), reroll. Shows winner banner and full entry list.
- **Ledger** (`/stats`): Day / Week / Month / Year / All-time range tabs that filter overview cards, top looters, and command usage. Includes an **Engagement Tips** card driven by `GET /stats/engagement` — lightweight heuristics (no giveaways in window, low command usage, few unique chatters, no loot drops, healthy) that surface 0–5 actionable suggestions, never auto-actions.
- **Spells** (`/commands`): Toggle individual chat commands on/off with live cooldown display.
- **Forge** (`/settings`): Bot display name, theme picker (goblin/cs2), Economy & Loot toggles (Random Goblin Events, Special-Item Loot Drops, Coin Redemption, Coin Balance Cap), Steam trade URL, Steam ID 64 with CS2 inventory grid. (Elimination Wheel settings — mode / speed / RPG flavor toggle — moved to a ⚙️ gear-icon popover inside the wheel modal itself; see `components/elimination-wheel.tsx#WheelSettingsPopover`.)
- **Trade Office** (`/trade-office`): Manage CS2 skin delivery to giveaway winners — track trade URLs, mark trade-locked items, add notes, update status (pending → sent).
- **Chat Users** (`/users`): List every viewer who has ever earned coins, redeemed coins, or held inventory in the streamer's channel. Shows current coin balance + 5-slot pouch preview, with an "Adjust Coins" dialog (+/- delta with optional reason) for streamer corrections.
- **Help & Guide** (`/help`): Static reference page with feature walkthroughs and the full chat command table. Linked from a pinned button at the bottom of the sidebar.
- **Loot Hoard Quick Prize panel**: streamer-only manual drop (coins or random item) on `/giveaway` page, no giveaway needed. Items roll into the viewer's pouch via `addInventoryItem`; falls back to a coin credit equal to the item's value if the pouch is full.
- **Elimination Wheel**: when ending a giveaway, opens a modal that animates through entries and eliminates one per round until the server-chosen winner remains. Settings: `wheelMode` (auto/manual) and `wheelSpeed` (slow/medium/fast).

## Bot Commands

Canonical commands (the Spells page lists only these — aliases share toggle, cooldown, and handler with their canonical):
- `!loot`, `!enter`, `!inventory`, `!sell <slot|all>`, `!use <slot>`, `!giveaway`, `!redeem`, `!tradeurl`
- `!help` — short, theme-aware list of currently-enabled commands (customizable; tokens: `{user}`, `{commands}`, `{theme}`)
- `!points` (alias: `!coins`) — show your coin balance (customizable; tokens: `{user}`, `{balance}`)
- `!goblin` (alias: `!skin`) — random themed taunt (customizable; tokens: `{user}`, `{theme}`)
- `!steal` (alias: `!scam`) — try to mug another viewer
- `!hoard` (alias: `!stash`) — show your coin balance (customizable; tokens: `{user}`, `{balance}`)
- `!feedgoblin` (alias: `!case`) — feed / open-case flavor response (customizable; tokens: `{user}`, `{theme}`)

**Customizable command responses** (Forge → Chat Commands): each `BUILT_IN_COMMANDS[name]` entry can opt in via `customizable: true`, `availableTokens: string[]`, and `defaultResponse: string`. The Spells/Forge UI renders an inline textarea + token-chip palette for those rows; the streamer's override is persisted to `usersTable.commandResponses` (jsonb) via `PUT /commands/:name/response` (empty body string clears). `getCommandConfig({channel})` is async and resolves the canonical name + the streamer's override; the bot calls `getCustomResponseFor(channel, canonical)` and renders with `renderTemplate(template, vars)`. `routes/commands.ts` MUST call `invalidateCommandResponses(channel)` after writes — the bot reads from the cache on every chat message. Adding a new customizable command: tag it in `BUILT_IN_COMMANDS`, swap the handler's hardcoded reply for `renderTemplate(getCustomResponseFor(channel, name) ?? DEFAULT, vars)`, and document the available tokens here.

`bot/bot-service.ts` defines aliases via `BUILT_IN_COMMANDS[name].aliasOf`. `getCommandConfig()` filters them out (only canonicals show up in the API + Spells page) and emits `aliases: string[]` on the canonical so the UI can hint them. `toggleCommandEnabled()` resolves to the canonical and propagates the new state to every alias so the bot's `command in COMMAND_ENABLED` check always sees a consistent value regardless of which name was typed.

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
- Giveaway prizes have three kinds (`prizeKind`), selected via a Prize Source dropdown on the create form: `cs2` (🔫 CS2 Skin — manual streamer delivery via Trade Office), `bot_item` (👺 Goblin Hoard — auto-rolls into winner's inventory; falls back to coin credit if pouch is full), `bot_coins` (🪙 Coins — credits `prizeBotCoins` directly to the winner via `loot_drops`). The labels stay goblin-themed regardless of `botTheme`; CS2 mode just rolls CS2-themed items at runtime because `rollLootDrop` filters `LOOT_TABLE` by active theme. Always serialize/deserialize all three new fields (`prizeKind`, `prizeBotCoins`, `prizeBotRarity`). **Combo prizes**: `prizeBotCoins` carries through for ALL kinds — main reward for `bot_coins`, optional bonus on top of the skin/loot for `cs2` and `bot_item` (winner gets both, awarded as a separate `loot_drops` insert with item label `"Giveaway Bonus: <title>"`). `prizeBotRarity` is meaningful for `bot_item` (biases the random roll) and cosmetic on `cs2` (the picked skin asset is what's actually delivered).
- Inventory is capped at 5 slots per (channel, username). All inserts MUST go through `addInventoryItem()` — it takes a per-user `pg_advisory_xact_lock` to enforce the cap under concurrency. The luck-buff charge consumption is atomic with the insert (pass `consumeLuckOnSuccess: true`); a "full" result never burns the charge.
- Ticket buff (`!enter`) is consumed only after the entry insert lands. The insert uses `onConflictDoNothing` on `(giveaway_id, username)` so a concurrent duplicate entry won't burn the buff either.
- New chat-driven inventory paths normalize username via `tags.username` (lowercase). Historical `loot_drops` / `point_redemptions` rows may be mixed-case, so balance lookups can split across casings until backfilled — known limitation, not a regression.
- `getPointsBalance(username, channel?)` takes an **optional** channel filter. Bot/leaderboard call sites omit it (legacy global-by-username, single-channel deployment). The Chat Users dashboard route always passes the streamer's channel so the same handle on different channels stays separate. Pass the channel any time you're operating in a multi-channel context; otherwise leave it off to match historical behavior.
- `Random Goblin Events` (settings toggle, default ON) picks from an in-memory `RECENT_CHATTERS` map per channel, so it activates only after viewers have spoken since the bot started. Steals are silently skipped when balance ≤ 0; events are logged in `goblin_events`.
- Per-channel runtime settings (`lootDropsEnabled`, `coinRedemptionEnabled`, `coinCap`, `goblinEventsEnabled`, `wheelMode`, `wheelSpeed`) live on `usersTable` and are cached in-memory by `bot/channel-settings.ts`. The settings PUT handler MUST call `invalidateChannelSettings(twitchUsername)` after writing — the bot reads the cache on every chat command.
- `usersTable.steamTradeUrl` is auto-populated when the streamer connects Steam (`routes/steam.ts`); the manual settings input has been removed because the bot delivers prizes to **winners'** trade URLs (collected via `!tradeurl` → `tradeFulfillmentsTable.steamTradeUrl`), not the streamer's own.
- `coinCap` is a **HARD limit** enforced per-channel. `bot/points.ts#clampCoinAward(channel, username, requested)` (and `clampCoinAwardTx`) reads the **streamer's** `usersTable.coinCap` (looked up by `twitchUsername == channel`, NOT the viewer's row — viewers aren't in usersTable), computes the viewer's current channel-scoped balance, and returns the max award that won't push past the ceiling. Every coin-credit insert MUST go through it: `bot/inventory.ts#sellInventoryItem` (uses `clampCoinAwardTx` inside the existing tx via dynamic import to avoid a circular module load), `bot/goblin-events.ts#fireDrop` (random goblin gifts), `routes/loot-hoard.ts` (manual coin drops + pouch-full item fallback), `routes/chat-users.ts` (positive streamer adjustments), and `routes/giveaway.ts#awardCoins` (covers `bot_coins` main reward, `bot_item` pouch-full fallback, and bonus combos for `cs2`/`bot_item`). `getPointsBalance(username, channel?)` only resolves a non-null `cap` when `channel` is supplied — without it (legacy `!coins`/leaderboard call sites) the read path returns `cap: null` and skips the defensive clip; the WRITE path is the source of truth either way.
- `!loot` and the manual `/loot-hoard/drop` route both pass `allowBuffs: false` to `rollLootDrop()` when `lootDropsEnabled` is OFF (or for streamer manual drops, since buffs would be confusing as a "Quick Prize"). Quick Prize items honor an optional rarity hint and re-pick from the matching tier of `LOOT_TABLE`.
- `!redeem` (chat) and `POST /giveaway/:id/redeem` (dashboard) both gate on `coinRedemptionEnabled` before reaching `redeemEntriesForUser()`. Disable both paths from a single toggle.
- Elimination wheel (`components/elimination-wheel.tsx`) is purely cosmetic: the server still picks the winner via `useEndGiveaway`. **Each ticket gets its own slot card** on the wheel — viewers with more tickets occupy more board real estate (`buildSlots(entries)` expands `WheelEntry.tickets` into `${username}-${idx}` slot keys). One of the winner's slots is randomly chosen as THE winning slot (`winningSlotKey`); every other slot — including the winner's other duplicate tickets — is shuffled into `eliminationOrder` and knocked out one by one. The 🔀 **Shuffle** button reshuffles the unprocessed tail of `eliminationOrder` for re-rolling drama. `wheelMode === "manual"` requires the streamer to click "Spin" between rounds; "auto" paces itself with `speedMs = {slow:1500, medium:900, fast:450}`. The "final two" phase always pauses for dramatic effect regardless of mode. **RPG flavor banner**: when `flavorEnabled` (driven by `usersTable.eliminationFlavorEnabled`), each elimination renders a random themed line from `components/elimination-flavors.ts` (`pickEliminationFlavor` / `pickFinalTwoFlavor` / `pickVictoryFlavor`). Banner color shifts purple → rose → amber across spinning / final-two / revealed phases. **Wheel settings live IN the modal** via the `WheelSettingsPopover` (⚙️ gear icon in the header) — Mode / Speed / Flavor toggle all `useUpdateBotSettings` and invalidate `getGetBotSettingsQueryKey()`. The Forge page no longer carries a wheel section. Required `EliminationWheel` props now include `flavorEnabled: boolean` — every caller must pass it (sourced from `useGetBotSettings`).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
