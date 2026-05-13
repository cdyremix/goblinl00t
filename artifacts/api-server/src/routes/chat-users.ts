import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, lootDropsTable, pointRedemptionsTable, userInventoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getPointsBalance, clampCoinAward } from "../bot/points";
import { logger } from "../lib/logger";
import { requireStreamerChannel } from "../lib/auth-helpers";

const router: IRouter = Router();

const CLIENT_ID = process.env["TWITCH_CLIENT_ID"] ?? "";

async function resolveChannel(req: Parameters<typeof getAuth>[0]): Promise<
  | { channel: string; twitchUserId: string | null; twitchAccessToken: string | null }
  | { error: string; status: number }
> {
  const { userId } = getAuth(req);
  if (!userId) return { error: "Unauthorized", status: 401 };
  const [user] = await db
    .select({ twitchUsername: usersTable.twitchUsername, twitchUserId: usersTable.twitchUserId, twitchAccessToken: usersTable.twitchAccessToken })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) return { error: "Unknown user", status: 401 };
  if (!user.twitchUsername) return { error: "Twitch channel not bound", status: 400 };
  return {
    channel: user.twitchUsername.toLowerCase(),
    twitchUserId: user.twitchUserId ?? null,
    twitchAccessToken: user.twitchAccessToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Best-effort Twitch enrichment
// Returns a map of lowercased username → twitch data.
// Fails gracefully — any error or missing scope returns nulls for that user.
// ---------------------------------------------------------------------------
interface TwitchUserInfo {
  followedAt: string | null;
  isSubscriber: boolean | null;
  subTier: string | null;
}

async function fetchTwitchEnrichment(
  broadcasterToken: string,
  broadcasterId: string,
  usernames: string[],
): Promise<Map<string, TwitchUserInfo>> {
  const result = new Map<string, TwitchUserInfo>();
  if (!CLIENT_ID || !broadcasterToken || !broadcasterId || usernames.length === 0) return result;

  for (const u of usernames) result.set(u, { followedAt: null, isSubscriber: null, subTier: null });

  const token = broadcasterToken.replace(/^oauth:/, "");
  const headers = { "Client-Id": CLIENT_ID, Authorization: `Bearer ${token}` };

  // Step 1 — resolve Twitch user IDs for all our usernames (100 per request)
  const usernameToId = new Map<string, string>(); // lowercase username → Twitch user ID
  try {
    for (let i = 0; i < usernames.length; i += 100) {
      const batch = usernames.slice(i, i + 100);
      const params = batch.map((u) => `login=${encodeURIComponent(u)}`).join("&");
      const r = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) {
        logger.warn({ status: r.status }, "Helix /users lookup failed — skipping Twitch enrichment");
        return result;
      }
      const data = (await r.json()) as { data?: Array<{ id: string; login: string }> };
      for (const u of data.data ?? []) usernameToId.set(u.login.toLowerCase(), u.id);
    }
  } catch (err) {
    logger.warn({ errMsg: (err as Error).message }, "Helix /users fetch error — skipping enrichment");
    return result;
  }

  // Step 2 — fetch all subscribers (requires channel:read:subscriptions scope)
  const subscriberMap = new Map<string, string>(); // Twitch user ID → sub tier
  try {
    let cursor: string | undefined;
    do {
      const url = new URL("https://api.twitch.tv/helix/subscriptions");
      url.searchParams.set("broadcaster_id", broadcasterId);
      url.searchParams.set("first", "100");
      if (cursor) url.searchParams.set("after", cursor);
      const r = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(6000) });
      if (!r.ok) break; // scope not available — leave subscriberMap empty, no warning needed
      const data = (await r.json()) as {
        data?: Array<{ user_id: string; tier: string }>;
        pagination?: { cursor?: string };
      };
      for (const sub of data.data ?? []) subscriberMap.set(sub.user_id, sub.tier);
      cursor = data.pagination?.cursor;
    } while (cursor);
  } catch {
    // Graceful — scope likely not granted yet
  }

  // Step 3 — check follower status per user in parallel (requires moderator:read:followers scope)
  const followerMap = new Map<string, string>(); // Twitch user ID → followed_at ISO string
  try {
    await Promise.all(
      [...usernameToId.entries()].map(async ([, userId]) => {
        try {
          const r = await fetch(
            `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${userId}&first=1`,
            { headers, signal: AbortSignal.timeout(5000) },
          );
          if (!r.ok) return; // scope not available for this user
          const data = (await r.json()) as { data?: Array<{ followed_at: string }> };
          const follow = data.data?.[0];
          if (follow) followerMap.set(userId, follow.followed_at);
        } catch {
          // individual fetch failed — silently skip
        }
      }),
    );
  } catch {
    // Graceful
  }

  // Build final enrichment map
  for (const [username] of result.entries()) {
    const userId = usernameToId.get(username);
    if (!userId) continue;
    const subTier = subscriberMap.get(userId) ?? null;
    result.set(username, {
      followedAt: followerMap.get(userId) ?? null,
      isSubscriber: subscriberMap.size > 0 ? subTier !== null : null,
      subTier,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// GET /chat-users
// ---------------------------------------------------------------------------
router.get("/chat-users", async (req, res) => {
  const ch = await resolveChannel(req);
  if ("error" in ch) {
    res.status(ch.status).json({ error: ch.error });
    return;
  }

  // Collect every distinct username we've ever seen on this channel
  const [earners, spenders, holders] = await Promise.all([
    db.selectDistinct({ username: lootDropsTable.username }).from(lootDropsTable).where(eq(lootDropsTable.channel, ch.channel)),
    db.selectDistinct({ username: pointRedemptionsTable.username }).from(pointRedemptionsTable).where(eq(pointRedemptionsTable.channel, ch.channel)),
    db.selectDistinct({ username: userInventoryTable.username }).from(userInventoryTable).where(eq(userInventoryTable.channel, ch.channel)),
  ]);

  const usernames = new Set<string>();
  for (const r of earners) usernames.add(r.username.toLowerCase());
  for (const r of spenders) usernames.add(r.username.toLowerCase());
  for (const r of holders) usernames.add(r.username.toLowerCase());

  // Pull all inventory rows in one query, bucket by user
  const allInventory = await db.select().from(userInventoryTable).where(eq(userInventoryTable.channel, ch.channel));
  const invByUser = new Map<string, typeof allInventory>();
  for (const row of allInventory) {
    const key = row.username.toLowerCase();
    const list = invByUser.get(key) ?? [];
    list.push(row);
    invByUser.set(key, list);
  }

  const sortedUsernames = [...usernames].sort();

  // Fetch coin balances + Twitch enrichment in parallel
  const [balances, twitchData] = await Promise.all([
    Promise.all(sortedUsernames.map((u) => getPointsBalance(u, ch.channel))),
    ch.twitchUserId && ch.twitchAccessToken
      ? fetchTwitchEnrichment(ch.twitchAccessToken, ch.twitchUserId, sortedUsernames)
      : Promise.resolve(new Map<string, TwitchUserInfo>()),
  ]);

  const result = sortedUsernames.map((username, idx) => {
    const balance = balances[idx]!;
    const inv = (invByUser.get(username) ?? []).sort((a, b) => a.id - b.id);
    const tw = twitchData.get(username) ?? null;
    return {
      username,
      coins: balance.balance,
      inventoryCount: inv.length,
      inventory: inv.map((i, slotIdx) => ({
        id: i.id,
        slot: slotIdx + 1,
        item: i.item,
        rarity: i.rarity,
        kind: i.kind,
        buffEffect: i.buffEffect ?? null,
        coinValue: i.coinValue,
        chargesRemaining: i.chargesRemaining,
        isActive: i.isActive,
      })),
      twitch: tw
        ? {
            followedAt: tw.followedAt,
            isSubscriber: tw.isSubscriber,
            subTier: tw.subTier,
          }
        : null,
    };
  });

  result.sort((a, b) => b.coins - a.coins);
  res.json(result);
});

// ---------------------------------------------------------------------------
// DELETE /chat-users/:username/inventory/:itemId
// Streamer removes an item from a viewer's pouch. No coin refund — admin action.
// ---------------------------------------------------------------------------
router.delete("/chat-users/:username/inventory/:itemId", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;

  const username = String(req.params["username"] ?? "").trim().toLowerCase();
  if (!username || !/^[a-z0-9_]{1,30}$/.test(username)) {
    res.status(400).json({ error: "Invalid username" });
    return;
  }

  const itemId = Number(req.params["itemId"]);
  if (!Number.isFinite(itemId)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const [existing] = await db
    .select({ id: userInventoryTable.id })
    .from(userInventoryTable)
    .where(
      and(
        eq(userInventoryTable.id, itemId),
        eq(userInventoryTable.channel, ctx.channel),
        eq(userInventoryTable.username, username),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  await db
    .delete(userInventoryTable)
    .where(
      and(
        eq(userInventoryTable.id, itemId),
        eq(userInventoryTable.channel, ctx.channel),
        eq(userInventoryTable.username, username),
      ),
    );

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /chat-users/:username/coins — adjust coin balance
// ---------------------------------------------------------------------------
router.post("/chat-users/:username/coins", async (req, res) => {
  const ch = await resolveChannel(req);
  if ("error" in ch) {
    res.status(ch.status).json({ error: ch.error });
    return;
  }

  const username = String(req.params["username"] ?? "").trim().toLowerCase();
  if (!username || !/^[a-z0-9_]{1,30}$/.test(username)) {
    res.status(400).json({ error: "Invalid username" });
    return;
  }

  const body = req.body as { delta?: number; reason?: string };
  const delta = Math.trunc(Number(body.delta ?? 0));
  if (!Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: "delta must be a non-zero integer" });
    return;
  }
  const reason = String(body.reason ?? "").trim().slice(0, 80);

  if (delta > 0) {
    const credited = await clampCoinAward(ch.channel, username, delta);
    if (credited > 0) {
      await db.insert(lootDropsTable).values({
        channel: ch.channel,
        username,
        item: reason ? `Streamer Adjustment: ${reason}` : "Streamer Adjustment",
        rarity: "epic",
        points: credited,
      });
    }
  } else {
    await db.insert(pointRedemptionsTable).values({
      channel: ch.channel,
      username,
      kind: "streamer_adjustment",
      points: Math.abs(delta),
      ticketsAdded: 0,
    });
  }

  const balance = await getPointsBalance(username, ch.channel);
  res.json({ ok: true, username, balance: balance.balance });
});

export default router;
