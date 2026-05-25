import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  twitchUserId: text("twitch_user_id"),
  twitchUsername: text("twitch_username").unique(),
  // Staff account flag — like `isAdmin` for FEATURE-GATE purposes
  // (`userHasFeature` short-circuits to true) but does NOT grant
  // `/admin/*` access. Used for moderators and internal staff who need
  // to manage the bot/dashboard during maintenance windows and exercise
  // every paid surface without holding a Stripe sub or inheriting
  // super-user (destructive admin) powers.
  isStaff: boolean("is_staff").notNull().default(false),
  twitchAccessToken: text("twitch_access_token"),
  twitchRefreshToken: text("twitch_refresh_token"),
  subscriptionTier: text("subscription_tier").notNull().default("premium"),
  // Super-user flag. When true, the row owner is treated as having every
  // feature regardless of `subscriptionTier` (server-side `userHasFeature`
  // short-circuits to true) AND can hit the `/api/admin/*` endpoints.
  // Populated automatically in `getOrCreateUser` whenever a sign-in's
  // primary email matches `SUPER_USER_EMAILS` (env-driven allowlist,
  // defaults to `c.borawa@gmail.com`). Manual flips happen via
  // `PATCH /api/admin/users/:id`. NEVER expose a write surface for
  // streamers themselves to flip this.
  isAdmin: boolean("is_admin").notNull().default(false),
  // True once the streamer has explicitly chosen (or acknowledged) a rank in
  // the post-signup tier picker. Drives the "pick your rank" modal in the
  // dashboard layout — modal opens whenever this is false for a signed-in
  // streamer. Free is a valid choice; the flag flips on ANY tier pick.
  tierSelected: boolean("tier_selected").notNull().default(false),
  botTheme: text("bot_theme").notNull().default("goblin"),
  botName: text("bot_name").notNull().default("Goblin L00t"),
  steamTradeUrl: text("steam_trade_url"),
  steamId64: text("steam_id64"),
  steamUsername: text("steam_username"),
  avatarPreset: text("avatar_preset"),
  goblinEventsEnabled: boolean("goblin_events_enabled").notNull().default(true),
  // Minimum minutes between random goblin-event drops per channel.
  // null = random 5–15 min (original behaviour). Integer = fixed floor in minutes.
  lootDropIntervalMinutes: integer("loot_drop_interval_minutes"),
  // Comma-separated or array of Twitch usernames the bot should completely
  // ignore (no commands, no coin drops, no goblin events).
  botBlacklist: jsonb("bot_blacklist").$type<string[]>(),
  // When false, !loot will not roll buff items (only plain sellable items).
  lootDropsEnabled: boolean("loot_drops_enabled").notNull().default(true),
  // When false, viewers cannot redeem coins for giveaway entries (!redeem & POST /redeem).
  coinRedemptionEnabled: boolean("coin_redemption_enabled").notNull().default(true),
  // Per-user max coin balance. null = no cap.
  coinCap: integer("coin_cap"),
  // Elimination wheel config: 'auto' spins through all eliminations on its own,
  // 'manual' requires the streamer to click "Spin" between rounds.
  wheelMode: text("wheel_mode").notNull().default("auto"),
  // Animation pacing: 'slow' | 'medium' | 'fast'.
  wheelSpeed: text("wheel_speed").notNull().default("medium"),
  // When true, the elimination wheel shows RPG-style flavor text on each
  // elimination (e.g. "{user} was struck by a goblin's club!"). Purely
  // cosmetic — no chat side effects, just modal eye candy.
  eliminationFlavorEnabled: boolean("elimination_flavor_enabled").notNull().default(true),
  // Deprecated — kept for back-compat with existing data. Operations now
  // shows a passive "current stream" window (last 6h) instead of a manual
  // start/end stamp. Reads still consult this column when set so legacy
  // sessions don't disappear, but no UI writes to it anymore.
  streamStartedAt: timestamp("stream_started_at"),
  // Per-channel overrides for built-in command responses. Keyed by canonical
  // command name (with leading `!`). Values are message templates that may
  // include tokens like {user}, {balance}, {target} — see BUILT_IN_COMMANDS
  // in bot-service.ts for which tokens each command supports.
  commandResponses: jsonb("command_responses").$type<Record<string, string>>(),
  // Per-channel on/off overrides for built-in commands. Keyed by canonical
  // command name (with leading `!`). When a key is absent, the bot uses the
  // built-in default (currently `true` for every shipped command). Mirror of
  // the `commandResponses` pattern — written by `POST /commands/:name/toggle`
  // and cached by `bot/command-toggles.ts`; every write MUST call
  // `invalidateCommandToggles(channel)`.
  commandToggles: jsonb("command_toggles").$type<Record<string, boolean>>(),
  // Optional Discord webhook URL — when set, giveaway end fires a posted
  // embed announcing the winner. Validated against discord.com/api/webhooks/...
  // before write; any other URL shape is rejected.
  discordWebhookUrl: text("discord_webhook_url"),
  // What !redeem does when coinRedemptionEnabled is true.
  // 'entries' = spend coins for giveaway entries (default, requires pending giveaway)
  // 'loot'    = spend coins to roll an extra loot item (always available)
  // 'luck'    = spend coins to gain a luck buff charge (always available)
  redeemAction: text("redeem_action").notNull().default("entries"),
  // Per-channel rarity weights for loot rolls. When null, the bot falls back
  // to the hardcoded defaults (common:50, uncommon:30, rare:15, epic:4, legendary:1).
  // Values are relative weights — they don't need to sum to 100; the roll is
  // normalised at runtime.
  lootRarityWeights: jsonb("loot_rarity_weights").$type<{
    common: number; uncommon: number; rare: number; epic: number; legendary: number;
  }>(),
  // Minimum rarity for the bot to announce a successful !loot result in chat.
  // Drops below this tier are silently added to inventory — the viewer still
  // gets the item, but the bot stays quiet. null / "all" = announce everything
  // (original behaviour). "uncommon" | "rare" | "epic" | "legendary" = quiet below.
  // Buffs are always announced regardless of this setting.
  lootAnnounceMinRarity: text("loot_announce_min_rarity"),
  // When true, personal command replies (!inventory, !points/!coins/!hoard,
  // !sell, !use) are sent via the Twitch Helix whisper API instead of public
  // chat. Falls back to public chat if the API rejects the whisper.
  // Requires TWITCH_OAUTH_TOKEN to have `user:manage:whispers` scope and the
  // bot account to have a verified phone number on Twitch.
  whisperModeEnabled: boolean("whisper_mode_enabled").notNull().default(true),
  // Stripe customer + active subscription IDs. Customer created lazily on
  // first checkout; subscription written back from webhook + reconciled
  // on every /users/me read so the UI is never stale even if a webhook
  // is missed. NEVER duplicate other Stripe data here — query the synced
  // `stripe.*` schema (managed by stripe-replit-sync) for prices, invoices,
  // products, etc.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
