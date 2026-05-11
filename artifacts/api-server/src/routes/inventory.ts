import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, INVENTORY_CAP } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listInventory, sellInventoryItem, useInventoryItem } from "../bot/inventory";
import { getPointsBalance, REDEEM_COST_PER_ENTRY } from "../bot/points";

const router: IRouter = Router();

async function getAuthedTwitchUsername(req: Parameters<typeof getAuth>[0]): Promise<string | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select({ twitchUsername: usersTable.twitchUsername })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  const handle = user?.twitchUsername?.trim().toLowerCase();
  return handle ? handle : null;
}

function defaultChannel(): string {
  return (process.env["TWITCH_CHANNEL"] ?? "goblinl00t").replace(/^#/, "").toLowerCase();
}

function serialize(item: Awaited<ReturnType<typeof listInventory>>[number]) {
  return {
    id: item.id,
    item: item.item,
    rarity: item.rarity,
    kind: item.kind,
    buffEffect: item.buffEffect ?? null,
    coinValue: item.coinValue,
    chargesRemaining: item.chargesRemaining,
    isActive: item.isActive,
    acquiredAt: item.acquiredAt.toISOString(),
  };
}

router.get("/inventory/me", async (req, res) => {
  const username = await getAuthedTwitchUsername(req);
  if (!username) { res.status(401).json({ error: "Sign in and link your Twitch username in settings." }); return; }
  const items = await listInventory(defaultChannel(), username);
  const { balance } = await getPointsBalance(username);
  res.json({
    items: items.map(serialize),
    cap: INVENTORY_CAP,
    balance,
    costPerEntry: REDEEM_COST_PER_ENTRY,
  });
});

router.post("/inventory/:itemId/sell", async (req, res) => {
  const username = await getAuthedTwitchUsername(req);
  if (!username) { res.status(401).json({ error: "Sign in and link your Twitch username in settings." }); return; }
  const itemId = Number(req.params["itemId"]);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid item id" }); return; }
  const result = await sellInventoryItem({ channel: defaultChannel(), username, itemId });
  if (!result.ok) {
    res.status(404).json({ error: "Item not found in your inventory" });
    return;
  }
  const { balance } = await getPointsBalance(username);
  res.json({ coinsEarned: result.coinsEarned ?? 0, balanceAfter: balance });
});

router.post("/inventory/:itemId/use", async (req, res) => {
  const username = await getAuthedTwitchUsername(req);
  if (!username) { res.status(401).json({ error: "Sign in and link your Twitch username in settings." }); return; }
  const itemId = Number(req.params["itemId"]);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid item id" }); return; }
  const result = await useInventoryItem({ channel: defaultChannel(), username, itemId });
  if (!result.ok) {
    if (result.reason === "not_buff") { res.status(400).json({ error: "This item is not a buff — try selling it instead." }); return; }
    res.status(404).json({ error: "Item not found in your inventory" });
    return;
  }
  res.json({
    item: result.item!.item,
    buffEffect: result.item!.buffEffect ?? "",
    chargesRemaining: result.item!.chargesRemaining,
  });
});

export default router;
