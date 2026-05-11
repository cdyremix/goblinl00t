import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, lootDropsTable, pointRedemptionsTable, userInventoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getPointsBalance } from "../bot/points";

const router: IRouter = Router();

async function resolveChannel(req: Parameters<typeof getAuth>[0]): Promise<{ channel: string } | { error: string; status: number }> {
  const { userId } = getAuth(req);
  if (!userId) return { error: "Unauthorized", status: 401 };
  const [user] = await db
    .select({ twitchUsername: usersTable.twitchUsername })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) return { error: "Unknown user", status: 401 };
  if (!user.twitchUsername) return { error: "Twitch channel not bound", status: 400 };
  return { channel: user.twitchUsername.toLowerCase() };
}

router.get("/chat-users", async (req, res) => {
  const ch = await resolveChannel(req);
  if ("error" in ch) {
    res.status(ch.status).json({ error: ch.error });
    return;
  }

  // Collect every distinct username we've ever seen on this channel — earners
  // (loot_drops), spenders (point_redemptions), and inventory holders.
  const [earners, spenders, holders] = await Promise.all([
    db.selectDistinct({ username: lootDropsTable.username }).from(lootDropsTable).where(eq(lootDropsTable.channel, ch.channel)),
    db.selectDistinct({ username: pointRedemptionsTable.username }).from(pointRedemptionsTable).where(eq(pointRedemptionsTable.channel, ch.channel)),
    db.selectDistinct({ username: userInventoryTable.username }).from(userInventoryTable).where(eq(userInventoryTable.channel, ch.channel)),
  ]);

  const usernames = new Set<string>();
  for (const r of earners) usernames.add(r.username.toLowerCase());
  for (const r of spenders) usernames.add(r.username.toLowerCase());
  for (const r of holders) usernames.add(r.username.toLowerCase());

  // Pull all inventory rows for the channel in one query, then bucket by user.
  const allInventory = await db
    .select()
    .from(userInventoryTable)
    .where(eq(userInventoryTable.channel, ch.channel));
  const invByUser = new Map<string, typeof allInventory>();
  for (const row of allInventory) {
    const key = row.username.toLowerCase();
    const list = invByUser.get(key) ?? [];
    list.push(row);
    invByUser.set(key, list);
  }

  const sorted = [...usernames].sort();
  const result = await Promise.all(
    sorted.map(async (username) => {
      const balance = await getPointsBalance(username, ch.channel);
      // user_inventory has no `slot` column — derive a 1-based slot index
      // from acquisition order so the UI has a stable display position.
      const inv = (invByUser.get(username) ?? []).sort((a, b) => a.id - b.id);
      return {
        username,
        coins: balance.balance,
        inventoryCount: inv.length,
        inventory: inv.map((i, idx) => ({
          id: i.id,
          slot: idx + 1,
          item: i.item,
          rarity: i.rarity,
          kind: i.kind,
        })),
      };
    }),
  );

  // Most coins first so the streamer can spot whales / outliers easily.
  result.sort((a, b) => b.coins - a.coins);
  res.json(result);
});

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
    // Positive adjustment → award via loot_drops so it flows through the
    // standard balance/leaderboard pipeline (same path streamer Quick Prize uses).
    await db.insert(lootDropsTable).values({
      channel: ch.channel,
      username,
      item: reason ? `Streamer Adjustment: ${reason}` : "Streamer Adjustment",
      rarity: "epic",
      points: delta,
    });
  } else {
    // Negative adjustment → record a point_redemption so the balance subtracts
    // it. We use kind='streamer_adjustment' to distinguish from real redemptions.
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
