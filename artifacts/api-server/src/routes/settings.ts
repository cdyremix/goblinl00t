import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setActiveTheme, type BotTheme } from "../bot/bot-themes";
import { setActiveBotName } from "../bot/bot-service";
import { invalidateChannelSettings } from "../bot/channel-settings";

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

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (body.botTheme !== undefined) {
    if (!VALID_THEMES.includes(body.botTheme as BotTheme)) {
      res.status(400).json({ error: "Invalid theme. Must be: goblin or cs2" });
      return;
    }
    updates.botTheme = body.botTheme;
    setActiveTheme(body.botTheme as BotTheme);
  }

  if (body.botName !== undefined) {
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
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      updates.discordWebhookUrl = null;
    } else if (typeof raw === "string" && /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/[\w/-]+$/.test(raw.trim())) {
      updates.discordWebhookUrl = raw.trim();
    } else {
      res.status(400).json({ error: "Invalid Discord webhook URL — must be a discord.com/api/webhooks/... URL." });
      return;
    }
  }

  const before = await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.clerkUserId, userId))
    .returning();

  // Invalidate channel cache for the linked twitch username so chat sees changes.
  const ch = updated?.twitchUsername ?? before.twitchUsername;
  if (ch) invalidateChannelSettings(ch);

  res.json(serializeSettings(updated!));
});

export default router;
