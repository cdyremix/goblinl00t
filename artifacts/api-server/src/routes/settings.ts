import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type BotTheme } from "../bot/bot-themes";
import { setActiveBotName } from "../bot/bot-service";
import { invalidateChannelSettings } from "../bot/channel-settings";
import { invalidateChannelTheme } from "../bot/channel-theme";
import { userHasFeature } from "../lib/tier-helpers";

const router = Router();

const VALID_THEMES: BotTheme[] = ["goblin", "cs2"];
const VALID_WHEEL_MODES = ["auto", "manual"] as const;
const VALID_WHEEL_SPEEDS = ["slow", "medium", "fast"] as const;

async function getOrCreateUser(clerkUserId: string) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(usersTable)
    .values({ clerkUserId, subscriptionTier: "free" })
    .returning();
  return created!;
}

function serializeSettings(user: typeof usersTable.$inferSelect) {
  return {
    botTheme: user.botTheme as BotTheme,
    botName: user.botName,
    steamTradeUrl: user.steamTradeUrl ?? null,
    steamId64: user.steamId64 ?? null,
    steamUsername: user.steamUsername ?? null,
    goblinEventsEnabled: user.goblinEventsEnabled,
    lootDropsEnabled: user.lootDropsEnabled,
    coinRedemptionEnabled: user.coinRedemptionEnabled,
    coinCap: user.coinCap,
    wheelMode: (user.wheelMode === "manual" ? "manual" : "auto") as "auto" | "manual",
    wheelSpeed:
      (user.wheelSpeed === "slow" || user.wheelSpeed === "fast" ? user.wheelSpeed : "medium") as
        | "slow"
        | "medium"
        | "fast",
    eliminationFlavorEnabled: user.eliminationFlavorEnabled,
    discordWebhookUrl: user.discordWebhookUrl ?? null,
  };
}

router.get("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getOrCreateUser(userId);
  res.json(serializeSettings(user));
});

router.put("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body as {
    botTheme?: string;
    botName?: string;
    steamTradeUrl?: string | null;
    steamId64?: string | null;
    steamUsername?: string | null;
    goblinEventsEnabled?: boolean;
    lootDropsEnabled?: boolean;
    coinRedemptionEnabled?: boolean;
    coinCap?: number | null;
    wheelMode?: string;
    wheelSpeed?: string;
    eliminationFlavorEnabled?: boolean;
    discordWebhookUrl?: string | null;
  };

  // Resolve the caller's row early so we can tier-gate paid settings
  // BEFORE applying any updates. UI gates on the dashboard mirror these
  // checks but are presentation-only — the API is the entitlement
  // boundary.
  const before = await getOrCreateUser(userId);

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (body.botTheme !== undefined) {
    if (!VALID_THEMES.includes(body.botTheme as BotTheme)) {
      res.status(400).json({ error: "Invalid theme. Must be: goblin or cs2" });
      return;
    }
    // CS2 theme is gated behind "all-themes" (Horde Master+). Free-tier
    // users can only run the default Goblin theme.
    if (body.botTheme === "cs2" && !userHasFeature(before, "all-themes")) {
      res.status(403).json({
        error: "The CS2 theme is a Horde Master perk. Upgrade to unlock all themes.",
        feature: "all-themes",
      });
      return;
    }
    updates.botTheme = body.botTheme;
    // Per-channel theme cache is invalidated below (after the DB write
    // returns) so we know the streamer's twitchUsername.
  }

  if (body.botName !== undefined) {
    // Custom bot display name is a Goblin King (pro) feature. Free /
    // premium users can only run the theme's default name.
    if (!userHasFeature(before, "custom-bot-name")) {
      res.status(403).json({
        error: "Custom bot name is a Goblin King perk.",
        feature: "custom-bot-name",
      });
      return;
    }
    const name = body.botName.trim();
    if (!name || name.length > 32) {
      res.status(400).json({ error: "Bot name must be 1–32 characters" });
      return;
    }
    updates.botName = name;
    setActiveBotName(name);
  }

  if ("steamTradeUrl" in body) updates.steamTradeUrl = body.steamTradeUrl ?? null;
  if ("steamId64" in body) updates.steamId64 = body.steamId64 ?? null;
  if ("steamUsername" in body) updates.steamUsername = body.steamUsername ?? null;
  if (typeof body.goblinEventsEnabled === "boolean") updates.goblinEventsEnabled = body.goblinEventsEnabled;
  if (typeof body.lootDropsEnabled === "boolean") updates.lootDropsEnabled = body.lootDropsEnabled;
  if (typeof body.coinRedemptionEnabled === "boolean") updates.coinRedemptionEnabled = body.coinRedemptionEnabled;
  if ("coinCap" in body) {
    if (body.coinCap === null || body.coinCap === undefined) {
      updates.coinCap = null;
    } else if (Number.isFinite(body.coinCap) && body.coinCap >= 0) {
      updates.coinCap = Math.floor(body.coinCap);
    } else {
      res.status(400).json({ error: "coinCap must be a non-negative integer or null" });
      return;
    }
  }
  if (body.wheelMode !== undefined) {
    if (!VALID_WHEEL_MODES.includes(body.wheelMode as (typeof VALID_WHEEL_MODES)[number])) {
      res.status(400).json({ error: "wheelMode must be 'auto' or 'manual'" });
      return;
    }
    updates.wheelMode = body.wheelMode;
  }
  if (body.wheelSpeed !== undefined) {
    if (!VALID_WHEEL_SPEEDS.includes(body.wheelSpeed as (typeof VALID_WHEEL_SPEEDS)[number])) {
      res.status(400).json({ error: "wheelSpeed must be 'slow', 'medium', or 'fast'" });
      return;
    }
    updates.wheelSpeed = body.wheelSpeed;
  }
  if (typeof body.eliminationFlavorEnabled === "boolean") {
    updates.eliminationFlavorEnabled = body.eliminationFlavorEnabled;
  }
  if ("discordWebhookUrl" in body) {
    const raw = body.discordWebhookUrl;
    const clearing = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
    // Setting (non-clearing) the webhook is a paid feature — clearing
    // is always allowed so a downgraded user can still take it off.
    if (!clearing && !userHasFeature(before, "discord-webhooks")) {
      res.status(403).json({
        error: "Discord webhook announcements are a Horde Master perk.",
        feature: "discord-webhooks",
      });
      return;
    }
    if (clearing) {
      updates.discordWebhookUrl = null;
    } else if (typeof raw === "string" && /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/[\w/-]+$/.test(raw.trim())) {
      updates.discordWebhookUrl = raw.trim();
    } else {
      res.status(400).json({ error: "Invalid Discord webhook URL — must be a discord.com/api/webhooks/... URL." });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.clerkUserId, userId))
    .returning();

  // Invalidate channel caches for the linked twitch username so chat
  // sees changes without a restart. Theme cache only matters when
  // botTheme actually changed, but invalidating unconditionally is
  // cheap (next read repopulates from DB).
  const ch = updated?.twitchUsername ?? before.twitchUsername;
  if (ch) {
    invalidateChannelSettings(ch);
    invalidateChannelTheme(ch);
  }

  res.json(serializeSettings(updated!));
});

export default router;
