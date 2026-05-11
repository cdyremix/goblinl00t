import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, lootDropsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { addInventoryItem, rollLootDrop } from "../bot/inventory";
import { LOOT_TABLE, type Rarity } from "../bot/loot-tables";

const router: IRouter = Router();

const VALID_RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/**
 * Streamer-initiated manual prize drop. Awards either coins (writes a
 * `loot_drops` row that flows through the standard balance/leaderboard) or
 * a random item rolled into the user's inventory. If the inventory is full
 * we fall back to a coin credit equal to the rolled item's value so the
 * prize is never silently dropped (mirrors giveaway bot_item fallback).
 */
router.post("/loot-hoard/drop", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  const channel = (user.twitchUsername ?? "goblinl00t").toLowerCase();

  const body = req.body as {
    username?: string;
    kind?: string;
    coins?: number;
    rarity?: string;
  };

  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username || !/^[a-z0-9_]{1,30}$/.test(username)) {
    res.status(400).json({ error: "username must be a valid twitch handle" });
    return;
  }
  const kind = body.kind === "item" ? "item" : body.kind === "coins" ? "coins" : null;
  if (!kind) {
    res.status(400).json({ error: "kind must be 'coins' or 'item'" });
    return;
  }

  if (kind === "coins") {
    const amount = Math.floor(Number(body.coins ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "coins must be a positive integer" });
      return;
    }
    await db.insert(lootDropsTable).values({
      channel,
      username,
      item: "Streamer Drop",
      rarity: "epic",
      points: amount,
    });
    res.json({
      ok: true,
      kind: "coins" as const,
      username,
      coinsAwarded: amount,
      itemAwarded: null,
      rarity: null,
      inventoryFull: false,
    });
    return;
  }

  // kind === "item": roll a random plain item (no buffs) honoring an optional rarity hint.
  const rarityHint =
    body.rarity && VALID_RARITIES.includes(body.rarity as Rarity)
      ? (body.rarity as Rarity)
      : null;
  let loot = rollLootDrop({ luckBuffActive: false, allowBuffs: false });
  if (rarityHint) {
    const pool = LOOT_TABLE.filter((i) => i.rarity === rarityHint);
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    loot = {
      item: pick.item,
      rarity: pick.rarity,
      kind: "item",
      buffEffect: null,
      coinValue: pick.points,
      charges: 0,
      flavor: loot.flavor,
    };
  }

  const result = await addInventoryItem(channel, username, loot);
  if (!result.ok) {
    // Pouch full → fall back to coin credit equal to the rolled item's value.
    await db.insert(lootDropsTable).values({
      channel,
      username,
      item: `Streamer Drop (pouch was full): ${loot.item}`,
      rarity: loot.rarity,
      points: loot.coinValue,
    });
    res.json({
      ok: true,
      kind: "item" as const,
      username,
      coinsAwarded: loot.coinValue,
      itemAwarded: loot.item,
      rarity: loot.rarity,
      inventoryFull: true,
    });
    return;
  }

  res.json({
    ok: true,
    kind: "item" as const,
    username,
    coinsAwarded: null,
    itemAwarded: loot.item,
    rarity: loot.rarity,
    inventoryFull: false,
  });
});

export default router;
