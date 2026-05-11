import { Router, type IRouter } from "express";
import { db, usersTable, INVENTORY_CAP } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listInventory, sellInventoryItem, useInventoryItem } from "../bot/inventory";
import { getPointsBalance, REDEEM_COST_PER_ENTRY } from "../bot/points";
import { requireStreamerChannel, resolveStreamerChannelForRead } from "../lib/auth-helpers";

const router: IRouter = Router();

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

// All `/inventory/*` endpoints scope to the caller's own channel
// (== caller's twitchUsername). The dashboard inventory view is the
// streamer reading their OWN pouch in their OWN channel, never another
// streamer's. The legacy `defaultChannel()` env-var fallback was
// removed — under multi-tenancy it would have shown every streamer the
// items earned in `process.env.TWITCH_CHANNEL`.

router.get("/inventory/me", async (req, res) => {
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const username = ctx.channel; // streamer reads their own pouch
  const items = await listInventory(ctx.channel, username);
  const { balance } = await getPointsBalance(username, ctx.channel);
  res.json({
    items: items.map(serialize),
    cap: INVENTORY_CAP,
    balance,
    costPerEntry: REDEEM_COST_PER_ENTRY,
  });
});

router.post("/inventory/:itemId/sell", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const username = ctx.channel;
  const itemId = Number(req.params["itemId"]);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid item id" }); return; }
  const result = await sellInventoryItem({ channel: ctx.channel, username, itemId });
  if (!result.ok) {
    res.status(404).json({ error: "Item not found in your inventory" });
    return;
  }
  const { balance } = await getPointsBalance(username, ctx.channel);
  res.json({ coinsEarned: result.coinsEarned ?? 0, balanceAfter: balance });
});

router.post("/inventory/:itemId/use", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const username = ctx.channel;
  const itemId = Number(req.params["itemId"]);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid item id" }); return; }
  const result = await useInventoryItem({ channel: ctx.channel, username, itemId });
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

// `usersTable` import retained via `auth-helpers`; explicit import kept above
// because Drizzle types are inferred from it elsewhere in this file's history.
void usersTable;
void eq;

export default router;
