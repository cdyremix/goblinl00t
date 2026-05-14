import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, lootDropsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { addInventoryItem, rollLootDrop } from "../bot/inventory";
import { LOOT_TABLE, type Rarity, type LootTheme } from "../bot/loot-tables";
import { clampCoinAward } from "../bot/points";

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
    const credited = await clampCoinAward(channel, username, amount);
    if (credited > 0) {
      await db.insert(lootDropsTable).values({
        channel,
        username,
        item: "Streamer Drop",
        rarity: "epic",
        points: credited,
      });
    }
    res.json({
      ok: true,
      kind: "coins" as const,
      username,
      coinsAwarded: credited,
      itemAwarded: null,
      rarity: null,
      inventoryFull: false,
      cappedAt: credited < amount ? credited : undefined,
    });
    return;
  }

  // kind === "item": roll a random plain item (no buffs) honoring an optional rarity hint.
  const theme: LootTheme = (user.botTheme === "cs2" ? "cs2" : user.botTheme === "hearthstone" ? "hearthstone" : "goblin");
  const rarityHint =
    body.rarity && VALID_RARITIES.includes(body.rarity as Rarity)
      ? (body.rarity as Rarity)
      : null;
  let loot = rollLootDrop({ luckBuffActive: false, allowBuffs: false, theme });
  if (rarityHint) {
    const themedPool = LOOT_TABLE.filter((i) => i.rarity === rarityHint && i.theme === theme);
    const pool = themedPool.length > 0 ? themedPool : LOOT_TABLE.filter((i) => i.rarity === rarityHint);
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
    const credited = await clampCoinAward(channel, username, loot.coinValue);
    if (credited > 0) {
      await db.insert(lootDropsTable).values({
        channel,
        username,
        item: `Streamer Drop (pouch was full): ${loot.item}`,
        rarity: loot.rarity,
        points: credited,
      });
    }
    res.json({
      ok: true,
      kind: "item" as const,
      username,
      coinsAwarded: credited,
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
