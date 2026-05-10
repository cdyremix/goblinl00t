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

- `lib/db/src/schema/` — DB schema (giveaways, giveaway_entries, loot_drops, command_logs)
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth for all endpoints
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `artifacts/api-server/src/` — Express API + bot service
  - `src/bot/bot-service.ts` — tmi.js Twitch bot (offline mode if no token)
  - `src/bot/loot-tables.ts` — rarity tiers and item pools
  - `src/routes/` — giveaway, loot, stats, commands, bot routes
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
- **Forge** (`/settings`): Bot display name, theme picker (goblin/cs2), Steam trade URL, Steam ID 64 with CS2 inventory grid.
- **Trade Office** (`/trade-office`): Manage CS2 skin delivery to giveaway winners — track trade URLs, mark trade-locked items, add notes, update status (pending → sent).

## Bot Commands

`!loot`, `!enter`, `!goblin`, `!steal`, `!hoard`, `!inventory`, `!feedgoblin`, `!giveaway`, `!tradeurl`

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

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
