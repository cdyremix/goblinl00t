/**
 * Viewer Portal routes — public viewer-facing Twitch OAuth + economy API.
 *
 * Auth model: lightweight signed httpOnly cookie (`goblin_viewer`) that
 * encodes { u: username, c: channel, exp }. Signed with SESSION_SECRET
 * (same key used everywhere else) via HMAC-SHA256. No Clerk dependency.
 *
 * OAuth redirect URI: set TWITCH_VIEWER_REDIRECT_URI in env, or falls back
 * to https://<REPLIT_DOMAINS[0]>/api/viewer/auth/callback. This URI must be
 * registered in the Twitch Developer Console alongside the streamer URI.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  lootDropsTable,
  pointRedemptionsTable,
  giveawaysTable,
  giveawayEntriesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sum, gt, count, or, desc } from "drizzle-orm";
import { userHasFeature } from "../lib/tier-helpers";
import { rateLimit } from "../lib/auth-helpers";
import { getChannelSettings } from "../bot/channel-settings";
import { getChannelTheme } from "../bot/channel-theme";
import {
  rollLootDrop,
  addInventoryItem,
  listInventory,
  sellInventoryItem,
  hasActiveBuff,
} from "../bot/inventory";
import {
  getPointsBalance,
  clampCoinAward,
  redeemEntriesForUser,
} from "../bot/points";
import { sayInChannel, getRecentChatMessages } from "../bot/bot-service";
import { logger } from "../lib/logger";

const router = Router();

const CLIENT_ID = process.env["TWITCH_CLIENT_ID"] ?? "";
const CLIENT_SECRET = process.env["TWITCH_CLIENT_SECRET"] ?? "";
const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "";

function getViewerRedirectUri(): string {
  return (
    process.env["TWITCH_VIEWER_REDIRECT_URI"] ??
    `https://${(process.env["REPLIT_DOMAINS"] ?? "localhost").split(",")[0]}/api/viewer/auth/callback`
  );
}

// ---------- Cookie helpers (no cookie-parser middleware) ----------

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}

// ---------- Viewer session cookie ----------

function signViewerSession(username: string, channel: string): string {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: username, c: channel, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyViewerSession(raw: string): { username: string; channel: string } | null {
  if (!SESSION_SECRET) return null;
  try {
    const dot = raw.lastIndexOf(".");
    if (dot < 0) return null;
    const payload = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u: string; c: string; exp: number;
    };
    if (!data || typeof data.u !== "string" || typeof data.c !== "string") return null;
    if (Date.now() > data.exp) return null;
    return { username: data.u, channel: data.c };
  } catch {
    return null;
  }
}

function requireViewerAuth(
  req: Parameters<typeof router.get>[1] extends (req: infer R, ...a: unknown[]) => unknown ? R : never,
  res: Parameters<typeof router.get>[1] extends (req: unknown, res: infer R, ...a: unknown[]) => unknown ? R : never,
  expectedChannel?: string,
): { username: string; channel: string } | null {
  const raw = parseCookie(req.headers.cookie, "goblin_viewer");
  if (!raw) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const session = verifyViewerSession(raw);
  if (!session) { res.status(401).json({ error: "Invalid or expired session" }); return null; }
  if (expectedChannel && session.channel !== expectedChannel) {
    res.status(403).json({ error: "Session is for a different channel" }); return null;
  }
  return session;
}

// ---------- OAuth state signing ----------

function signViewerState(channel: string): string {
  const exp = Date.now() + 10 * 60 * 1000;
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${channel}.${exp}.${nonce}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

function verifyViewerState(state: string): string | null {
  if (!SESSION_SECRET) return null;
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 4) return null;
    const [channel, expStr, nonce, sig] = parts as [string, string, string, string];
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(`${channel}.${expStr}.${nonce}`)
      .digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return channel;
  } catch {
    return null;
  }
}

// ---------- Leaderboard helper ----------

async function getLeaderboard(channel: string, limit = 10) {
  const [earnedRows, redeemedRows] = await Promise.all([
    db
      .select({ username: lootDropsTable.username, total: sum(lootDropsTable.points) })
      .from(lootDropsTable)
      .where(and(eq(lootDropsTable.channel, channel), gt(lootDropsTable.points, 0)))
      .groupBy(lootDropsTable.username),
    db
      .select({ username: pointRedemptionsTable.username, total: sum(pointRedemptionsTable.points) })
      .from(pointRedemptionsTable)
      .where(eq(pointRedemptionsTable.channel, channel))
      .groupBy(pointRedemptionsTable.username),
  ]);
  const redeemMap = new Map(redeemedRows.map((r) => [r.username, Number(r.total ?? 0)]));
  return earnedRows
    .map((r) => ({
      username: r.username,
      balance: Number(r.total ?? 0) - (redeemMap.get(r.username) ?? 0),
    }))
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

// ---------- Channel streamer helper ----------

async function getChannelStreamer(channel: string) {
  const [streamer] = await db
    .select({
      subscriptionTier: usersTable.subscriptionTier,
      isAdmin: usersTable.isAdmin,
      coinRedemptionEnabled: usersTable.coinRedemptionEnabled,
      redeemAction: usersTable.redeemAction,
    })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, channel))
    .limit(1);
  return streamer ?? null;
}

// ---------- In-memory loot cooldowns ----------

const lootCooldowns = new Map<string, number>();
const LOOT_COOLDOWN_MS = 30_000;

// ============================================================
// Auth routes
// ============================================================

// GET /viewer/auth/init?channel=goblinl00t — send viewer to Twitch OAuth
router.get("/viewer/auth/init", (req, res) => {
    if (!rateLimit(`viewer_auth_init:${req.ip ?? "unknown"}`, { max: 20, windowMs: 60_000 })) {
      res.status(429).json({ error: "Too many requests — try again in a minute" });
      return;
    }
    const channel = String(req.query["channel"] ?? "")
      .toLowerCase()
      .replace(/^#/, "");
    if (!channel) { res.status(400).json({ error: "channel is required" }); return; }
    if (!CLIENT_ID || !SESSION_SECRET) {
      res.status(500).json({ error: "Twitch OAuth not configured on this server" });
      return;
    }
    const state = signViewerState(channel);
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", getViewerRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user:read:email");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  },
);

// GET /viewer/auth/callback — Twitch lands here after the viewer approves
router.get("/viewer/auth/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  const channel = verifyViewerState(state ?? "");
  if (!channel) {
    res.status(400).send("Invalid or expired state. Please try again.");
    return;
  }
  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }
  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: getViewerRedirectUri(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error("No access_token in response");

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: { "Client-Id": CLIENT_ID, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!userRes.ok) throw new Error(`Helix users failed: ${userRes.status}`);
    const userData = (await userRes.json()) as { data?: Array<{ login: string }> };
    const username = userData.data?.[0]?.login?.toLowerCase();
    if (!username) throw new Error("No username in Twitch response");

    const cookieVal = signViewerSession(username, channel);
    const isSecure = process.env["NODE_ENV"] === "production";
    const cookieStr = [
      `goblin_viewer=${encodeURIComponent(cookieVal)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${24 * 60 * 60}`,
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    res.setHeader("Set-Cookie", cookieStr);
    res.redirect(`/viewer/${channel}`);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer auth callback failed");
    res.status(500).send("Authentication failed. Please try again.");
  }
});

// GET /viewer/auth/me — lets the frontend check current session without reading the cookie directly
router.get("/viewer/auth/me", (req, res) => {
  const raw = parseCookie(req.headers.cookie, "goblin_viewer");
  if (!raw) { res.json({ loggedIn: false }); return; }
  const session = verifyViewerSession(raw);
  if (!session) { res.json({ loggedIn: false }); return; }
  res.json({ loggedIn: true, username: session.username, channel: session.channel });
});

// POST /viewer/auth/logout — clear the viewer cookie
router.post("/viewer/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "goblin_viewer=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

// ============================================================
// Public: channel status
// ============================================================

// GET /viewer/:channel/status — public: leaderboard + pending/active giveaway + entry count
router.get("/viewer/:channel/status", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  try {
    const [streamer, currentGiveawayRows] = await Promise.all([
      getChannelStreamer(channel),
      db
        .select()
        .from(giveawaysTable)
        .where(
          and(
            eq(giveawaysTable.channel, channel),
            or(eq(giveawaysTable.status, "pending"), eq(giveawaysTable.status, "active")),
          ),
        )
        .orderBy(desc(giveawaysTable.createdAt))
        .limit(1),
    ]);

    const proRequired =
      !streamer?.isAdmin &&
      !userHasFeature(
        streamer
          ? { subscriptionTier: streamer.subscriptionTier, isAdmin: streamer.isAdmin, isStaff: false }
          : null,
        "viewer-portal",
      );

    const currentGiveaway = currentGiveawayRows[0] ?? null;
    let entryCount = 0;
    if (currentGiveaway) {
      const [ec] = await db
        .select({ n: count() })
        .from(giveawayEntriesTable)
        .where(eq(giveawayEntriesTable.giveawayId, currentGiveaway.id));
      entryCount = ec?.n ?? 0;
    }

    const leaderboard = await getLeaderboard(channel);
    res.json({
      giveaway: currentGiveaway,
      entryCount,
      leaderboard,
      proRequired,
      redeemAction: (streamer?.redeemAction ?? "entries") as "entries" | "loot" | "luck",
      entriesOpen: currentGiveaway?.status === "pending",
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer status failed");
    res.status(500).json({ error: "Failed to load channel status" });
  }
});

// ============================================================
// Authed: personal data
// ============================================================

// GET /viewer/:channel/me — balance, inventory, rank
router.get("/viewer/:channel/me", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const session = requireViewerAuth(req as never, res as never, channel);
  if (!session) return;
  try {
    const [balance, inventory, leaderboard] = await Promise.all([
      getPointsBalance(session.username, channel),
      listInventory(channel, session.username),
      getLeaderboard(channel, 500),
    ]);
    const rank = leaderboard.findIndex((r) => r.username === session.username);
    res.json({
      username: session.username,
      balance,
      inventory,
      rank: rank >= 0 ? rank + 1 : null,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer me failed");
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// GET /viewer/:channel/chat — live chat ring buffer polled by viewer portal (public)
router.get("/viewer/:channel/chat", (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const limit = Math.min(75, Math.max(10, Number(req.query["limit"] ?? 50)));
  res.json({ messages: getRecentChatMessages(channel, limit) });
});

// ============================================================
// Authed: actions
// ============================================================

// POST /viewer/:channel/loot — roll loot (30 s cooldown)
router.post("/viewer/:channel/loot", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const session = requireViewerAuth(req as never, res as never, channel);
  if (!session) return;

  const cooldownKey = `${channel}:${session.username}`;
  const last = lootCooldowns.get(cooldownKey) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < LOOT_COOLDOWN_MS) {
    const retryAfter = Math.ceil((LOOT_COOLDOWN_MS - elapsed) / 1000);
    res.status(429).json({ error: "On cooldown", retryAfter });
    return;
  }

  try {
    const settings = await getChannelSettings(channel);
    if (!settings.lootDropsEnabled) {
      res.status(403).json({ error: "Loot drops are disabled for this channel" });
      return;
    }
    const [theme, luckActive] = await Promise.all([
      getChannelTheme(channel),
      hasActiveBuff(channel, session.username, "luck"),
    ]);
    const loot = rollLootDrop({ luckBuffActive: luckActive, allowBuffs: true, theme });
    lootCooldowns.set(cooldownKey, Date.now());

    const result = await addInventoryItem(channel, session.username, loot, {
      consumeLuckOnSuccess: true,
    });

    if (!result.ok && result.reason === "full") {
      const awarded = await clampCoinAward(channel, session.username, loot.coinValue);
      if (awarded > 0) {
        await db.insert(lootDropsTable).values({
          username: session.username,
          channel,
          item: loot.item,
          rarity: loot.rarity,
          points: awarded,
        });
      }
      void sayInChannel(channel, `🎲 @${session.username} rolled loot from the viewer portal — pouch full, converted ${loot.item} to ${awarded}🪙!`);
      res.json({ type: "coins", item: loot.item, rarity: loot.rarity, coins: awarded, flavor: loot.flavor });
      return;
    }

    await db.insert(lootDropsTable).values({
      username: session.username,
      channel,
      item: loot.item,
      rarity: loot.rarity,
      points: 0,
    });
    void sayInChannel(channel, `🎲 @${session.username} rolled loot from the viewer portal — ${loot.rarity} ${loot.item}! ${loot.flavor}`);
    res.json({ type: "item", item: loot.item, rarity: loot.rarity, slot: result.slot, flavor: loot.flavor });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer loot failed");
    res.status(500).json({ error: "Loot roll failed" });
  }
});

// POST /viewer/:channel/enter — enter a pending giveaway (entries locked once started)
router.post("/viewer/:channel/enter", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const session = requireViewerAuth(req as never, res as never, channel);
  if (!session) return;
  try {
    const [giveaway] = await db
      .select()
      .from(giveawaysTable)
      .where(and(eq(giveawaysTable.channel, channel), eq(giveawaysTable.status, "pending")))
      .limit(1);
    if (!giveaway) {
      // Check if there's an active (wheel-phase) giveaway to give a better error
      const [spinning] = await db
        .select({ id: giveawaysTable.id })
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.channel, channel), eq(giveawaysTable.status, "active")))
        .limit(1);
      const msg = spinning
        ? "The giveaway has started — entries are now closed!"
        : "No open giveaway accepting entries";
      res.status(404).json({ error: msg });
      return;
    }

    await db
      .insert(giveawayEntriesTable)
      .values({ giveawayId: giveaway.id, username: session.username, tickets: 1 })
      .onConflictDoNothing();

    void sayInChannel(channel, `🏆 @${session.username} entered the giveaway via viewer portal!`);
    res.json({ ok: true, giveawayTitle: giveaway.title });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer enter failed");
    res.status(500).json({ error: "Failed to enter giveaway" });
  }
});

// POST /viewer/:channel/sell — sell an inventory item by id
router.post("/viewer/:channel/sell", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const session = requireViewerAuth(req as never, res as never, channel);
  if (!session) return;

  const itemId = Number((req.body as Record<string, unknown>)?.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    res.status(400).json({ error: "itemId is required" });
    return;
  }
  try {
    const result = await sellInventoryItem({
      channel,
      username: session.username,
      itemId,
    });
    if (!result.ok) { res.status(404).json({ error: "Item not found" }); return; }
    void sayInChannel(channel, `💰 @${session.username} sold ${String(result.item?.item ?? "an item")} for ${result.coinsEarned}🪙 via viewer portal!`);
    res.json({ ok: true, item: result.item, coinsEarned: result.coinsEarned });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer sell failed");
    res.status(500).json({ error: "Failed to sell item" });
  }
});

// POST /viewer/:channel/redeem — spend coins (action depends on channel's redeemAction setting)
router.post("/viewer/:channel/redeem", async (req, res) => {
  const channel = req.params["channel"]!.toLowerCase();
  const session = requireViewerAuth(req as never, res as never, channel);
  if (!session) return;

  const entries = Math.max(1, Math.floor(Number((req.body as Record<string, unknown>)?.entries ?? 1)));
  try {
    const [streamer, channelSettings] = await Promise.all([
      getChannelStreamer(channel),
      getChannelSettings(channel),
    ]);

    if (!channelSettings.coinRedemptionEnabled) {
      res.status(403).json({ error: "Coin redemption is disabled for this channel" });
      return;
    }

    const redeemAction = streamer?.redeemAction ?? "entries";

    // ── entries mode: spend 100 coins per ticket into a pending giveaway ──
    if (redeemAction === "entries") {
      const [giveaway] = await db
        .select()
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.channel, channel), eq(giveawaysTable.status, "pending")))
        .limit(1);
      if (!giveaway) {
        const [spinning] = await db
          .select({ id: giveawaysTable.id })
          .from(giveawaysTable)
          .where(and(eq(giveawaysTable.channel, channel), eq(giveawaysTable.status, "active")))
          .limit(1);
        const msg = spinning
          ? "The giveaway has started — entries are now closed!"
          : "No open giveaway accepting entries";
        res.status(404).json({ error: msg });
        return;
      }
      const result = await redeemEntriesForUser({ giveawayId: giveaway.id, username: session.username, entries });
      if (!result.ok) { res.status(400).json({ error: result.message }); return; }
      void sayInChannel(channel, `🎟️ @${session.username} redeemed ${result.ticketsAdded ?? entries} ticket${(result.ticketsAdded ?? entries) !== 1 ? "s" : ""} via viewer portal!`);
      res.json(result);
      return;
    }

    // ── loot mode: 200 coins → roll a loot item ──
    if (redeemAction === "loot") {
      const COST = 200;
      const { balance } = await getPointsBalance(session.username, channel);
      if (balance < COST) {
        res.status(400).json({ error: `Not enough coins — need ${COST}🪙 but you have ${balance}🪙` });
        return;
      }
      await db.insert(lootDropsTable).values({
        username: session.username, channel,
        item: "Redeem: Loot Roll", rarity: "common", points: -COST,
      });
      const theme = await getChannelTheme(channel);
      const loot = rollLootDrop({ luckBuffActive: false, allowBuffs: true, theme });
      const result = await addInventoryItem(channel, session.username, loot, { consumeLuckOnSuccess: false });
      if (!result.ok) {
        const awarded = await clampCoinAward(channel, session.username, loot.coinValue);
        if (awarded > 0) {
          await db.insert(lootDropsTable).values({ username: session.username, channel, item: loot.item, rarity: loot.rarity, points: awarded });
        }
        void sayInChannel(channel, `🎲 @${session.username} spent 200🪙 on portal loot — pouch full, converted ${loot.item} to ${awarded}🪙!`);
        res.json({ ok: true, action: "loot", type: "coins", item: loot.item, rarity: loot.rarity, coins: awarded, flavor: loot.flavor });
        return;
      }
      await db.insert(lootDropsTable).values({ username: session.username, channel, item: loot.item, rarity: loot.rarity, points: 0 });
      void sayInChannel(channel, `🎲 @${session.username} spent 200🪙 and rolled ${loot.rarity} ${loot.item} from the portal!`);
      res.json({ ok: true, action: "loot", type: "item", item: loot.item, rarity: loot.rarity, slot: result.slot, flavor: loot.flavor });
      return;
    }

    // ── luck mode: 300 coins → Lucky Charm buff ──
    if (redeemAction === "luck") {
      const COST = 300;
      const { balance } = await getPointsBalance(session.username, channel);
      if (balance < COST) {
        res.status(400).json({ error: `Not enough coins — need ${COST}🪙 but you have ${balance}🪙` });
        return;
      }
      await db.insert(lootDropsTable).values({
        username: session.username, channel,
        item: "Redeem: Luck Buff", rarity: "uncommon", points: -COST,
      });
      const luckItem = {
        item: "Lucky Charm", rarity: "uncommon" as const, kind: "buff" as const,
        buffEffect: "luck" as const, charges: 1, coinValue: 0,
        flavor: "Your next !loot roll gets an upgraded rarity!",
      };
      const result = await addInventoryItem(channel, session.username, luckItem, { consumeLuckOnSuccess: false });
      if (!result.ok) {
        // Inventory full — refund the cost
        await db.insert(lootDropsTable).values({
          username: session.username, channel,
          item: "Luck Buff Refund (full inventory)", rarity: "common", points: COST,
        });
        res.status(400).json({ error: "Inventory full — sell an item first" });
        return;
      }
      void sayInChannel(channel, `🍀 @${session.username} spent 300🪙 for a Lucky Charm buff via viewer portal!`);
      res.json({ ok: true, action: "luck", slot: result.slot });
      return;
    }

    res.status(400).json({ error: "Unknown redeem action" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "viewer redeem failed");
    res.status(500).json({ error: "Failed to redeem" });
  }
});

export default router;
