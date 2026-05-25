import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, scheduledAnnouncementsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireStreamerChannel } from "../lib/auth-helpers";
import { type BotTheme } from "../bot/bot-themes";
import { setActiveBotName } from "../bot/bot-service";
import { invalidateChannelSettings } from "../bot/channel-settings";
import { invalidateChannelTheme } from "../bot/channel-theme";
import { userHasFeature } from "../lib/tier-helpers";

const router = Router();

const VALID_THEMES: BotTheme[] = ["goblin", "cs2", "hearthstone"];
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
    lootDropIntervalMinutes: user.lootDropIntervalMinutes ?? null,
    botBlacklist: (Array.isArray(user.botBlacklist) ? user.botBlacklist : []) as string[],
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
    lootRarityWeights: user.lootRarityWeights ?? null,
    redeemAction: (user.redeemAction ?? "entries") as "entries" | "loot" | "luck",
    lootAnnounceMinRarity: user.lootAnnounceMinRarity ?? null,
    whisperModeEnabled: user.whisperModeEnabled,
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
    lootDropIntervalMinutes?: number | null;
    botBlacklist?: string[] | null;
    lootDropsEnabled?: boolean;
    coinRedemptionEnabled?: boolean;
    coinCap?: number | null;
    wheelMode?: string;
    wheelSpeed?: string;
    eliminationFlavorEnabled?: boolean;
    discordWebhookUrl?: string | null;
    lootRarityWeights?: {
      common: number; uncommon: number; rare: number; epic: number; legendary: number;
    } | null;
    redeemAction?: string;
    lootAnnounceMinRarity?: string | null;
    whisperModeEnabled?: boolean;
  };

  // Resolve the caller's row early so we can tier-gate paid settings
  // BEFORE applying any updates. UI gates on the dashboard mirror these
  // checks but are presentation-only — the API is the entitlement
  // boundary.
  const before = await getOrCreateUser(userId);

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (body.botTheme !== undefined) {
    if (!VALID_THEMES.includes(body.botTheme as BotTheme)) {
      res.status(400).json({ error: "Invalid theme. Must be: goblin, cs2, or hearthstone" });
      return;
    }
    // Non-default themes are gated behind "all-themes" (Horde Master+).
    // Free-tier users can only run the default Goblin theme.
    if (body.botTheme !== "goblin" && !userHasFeature(before, "all-themes")) {
      res.status(403).json({
        error: "Alternative themes are a Horde Master perk. Upgrade to unlock CS2 and Hearthstone modes.",
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
  if ("lootDropIntervalMinutes" in body) {
    const v = body.lootDropIntervalMinutes;
    if (v === null || v === undefined) {
      updates.lootDropIntervalMinutes = null;
    } else if (Number.isFinite(v) && v >= 1 && v <= 120) {
      updates.lootDropIntervalMinutes = Math.floor(v);
    } else {
      res.status(400).json({ error: "lootDropIntervalMinutes must be 1–120 or null" });
      return;
    }
  }
  if ("botBlacklist" in body) {
    const raw = body.botBlacklist;
    if (raw === null || raw === undefined) {
      updates.botBlacklist = null;
    } else if (Array.isArray(raw)) {
      const cleaned = raw
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim().toLowerCase().replace(/^@/, ""));
      if (cleaned.some((u) => u.length > 25)) {
        res.status(400).json({ error: "Usernames must be 25 characters or fewer" });
        return;
      }
      updates.botBlacklist = cleaned as string[];
    } else {
      res.status(400).json({ error: "botBlacklist must be an array or null" });
      return;
    }
  }
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
  if ("lootRarityWeights" in body) {
    const w = body.lootRarityWeights;
    if (w === null || w === undefined) {
      updates.lootRarityWeights = null;
    } else {
      const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
      const allValid = RARITIES.every(
        (r) => typeof w[r] === "number" && Number.isFinite(w[r]) && w[r] >= 0,
      );
      if (!allValid || RARITIES.reduce((s, r) => s + w[r], 0) === 0) {
        res.status(400).json({ error: "lootRarityWeights must be an object with non-negative numbers that don't all sum to zero" });
        return;
      }
      updates.lootRarityWeights = w;
    }
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

  if (typeof body.redeemAction === "string") {
    const VALID_REDEEM_ACTIONS = ["entries", "loot", "luck"] as const;
    if (!VALID_REDEEM_ACTIONS.includes(body.redeemAction as (typeof VALID_REDEEM_ACTIONS)[number])) {
      res.status(400).json({ error: "redeemAction must be 'entries', 'loot', or 'luck'" });
      return;
    }
    updates.redeemAction = body.redeemAction;
  }

  if (typeof body.whisperModeEnabled === "boolean") {
    updates.whisperModeEnabled = body.whisperModeEnabled;
  }

  if ("lootAnnounceMinRarity" in body) {
    const v = body.lootAnnounceMinRarity;
    const VALID_ANNOUNCE_RARITIES = ["all", "uncommon", "rare", "epic", "legendary"] as const;
    if (v === null || v === undefined || v === "all") {
      updates.lootAnnounceMinRarity = null;
    } else if (VALID_ANNOUNCE_RARITIES.includes(v as (typeof VALID_ANNOUNCE_RARITIES)[number])) {
      updates.lootAnnounceMinRarity = v;
    } else {
      res.status(400).json({ error: "lootAnnounceMinRarity must be null, 'all', 'uncommon', 'rare', 'epic', or 'legendary'" });
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

router.post("/settings/test-webhook", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select({ url: usersTable.discordWebhookUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);

  const url = user?.url;
  if (!url) {
    res.status(400).json({ error: "No Discord webhook URL saved. Save a webhook URL first." });
    return;
  }
  if (!/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
    res.status(400).json({ error: "Saved webhook URL is invalid." });
    return;
  }

  const body = {
    embeds: [{
      title: "🧪 Goblin L00t — Test Notification",
      description: "**Winner:** TestViewer123\n**Prize:** Epic Goblin Sword\n**Entries:** 42\n\nIf you can see this, your webhook is wired up correctly!",
      color: 0xf5aa1e,
      footer: { text: "Goblin L00t · Test" },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      res.status(502).json({ error: `Discord returned ${r.status} — check that the webhook URL is still valid.` });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Network error";
    res.status(502).json({ error: `Could not reach Discord: ${errMessage}` });
  }
});

// ─── Scheduled Announcements ────────────────────────────────────────────────

router.get("/settings/announcements", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(scheduledAnnouncementsTable)
    .where(eq(scheduledAnnouncementsTable.channel, ctx.channel))
    .orderBy(scheduledAnnouncementsTable.createdAt);
  res.json(rows);
});

router.post("/settings/announcements", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const { message, intervalMinutes } = req.body as { message?: string; intervalMinutes?: number };
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message required" }); return;
  }
  const interval = Number(intervalMinutes);
  if (!interval || interval < 1 || interval > 720) {
    res.status(400).json({ error: "intervalMinutes must be 1–720" }); return;
  }
  const [row] = await db.insert(scheduledAnnouncementsTable).values({
    channel: ctx.channel,
    message: message.trim(),
    intervalMinutes: interval,
    enabled: true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/settings/announcements/:id", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }
  const { enabled, message, intervalMinutes } = req.body as {
    enabled?: boolean; message?: string; intervalMinutes?: number;
  };
  const patch: Partial<typeof scheduledAnnouncementsTable.$inferInsert> = {};
  if (enabled !== undefined) patch.enabled = Boolean(enabled);
  if (message !== undefined) patch.message = String(message).trim();
  if (intervalMinutes !== undefined) patch.intervalMinutes = Number(intervalMinutes);
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "nothing to update" }); return; }
  const [updated] = await db
    .update(scheduledAnnouncementsTable)
    .set(patch)
    .where(and(eq(scheduledAnnouncementsTable.id, id), eq(scheduledAnnouncementsTable.channel, ctx.channel)))
    .returning();
  if (!updated) { res.status(404).json({ error: "not found" }); return; }
  res.json(updated);
});

router.delete("/settings/announcements/:id", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }
  const result = await db
    .delete(scheduledAnnouncementsTable)
    .where(and(eq(scheduledAnnouncementsTable.id, id), eq(scheduledAnnouncementsTable.channel, ctx.channel)))
    .returning({ id: scheduledAnnouncementsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "not found" }); return; }
  res.status(204).end();
});

export default router;
