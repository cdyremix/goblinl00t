import { db, userInventoryTable, lootDropsTable, INVENTORY_CAP } from "@workspace/db";
import type { UserInventoryItem } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { Rarity, LootTheme } from "./loot-tables";
import { LOOT_TABLE, getRarityEmoji } from "./loot-tables";
import { logger } from "../lib/logger";

export type BuffEffect = "luck" | "coins" | "tickets";

export interface BuffDef {
  item: string;
  rarity: Rarity;
  effect: BuffEffect;
  charges: number;
  coinValue: number;
  flavor: string;
}

export const BUFF_TABLE: BuffDef[] = [
  { item: "Lucky Charm",     rarity: "uncommon",  effect: "luck",    charges: 5, coinValue: 50,  flavor: "+25% chance to upgrade your next loot rolls" },
  { item: "Goblin Blessing", rarity: "rare",      effect: "coins",   charges: 3, coinValue: 200, flavor: "doubles the coins from your next sells" },
  { item: "Hoard Magnet",    rarity: "rare",      effect: "tickets", charges: 1, coinValue: 250, flavor: "your next !enter grants +1 extra ticket" },
  { item: "Trickster's Die", rarity: "epic",      effect: "luck",    charges: 8, coinValue: 600, flavor: "+25% chance to upgrade your next loot rolls" },
];

const BUFF_DROP_CHANCE = 0.10;

export interface RolledLoot {
  item: string;
  rarity: Rarity;
  kind: "item" | "buff";
  buffEffect: BuffEffect | null;
  coinValue: number;
  charges: number;
  flavor: string;
}

const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

function baseRoll(theme: LootTheme): { item: string; rarity: Rarity; points: number } {
  const r = Math.random() * 100;
  let rarity: Rarity;
  if (r < 1) rarity = "legendary";
  else if (r < 5) rarity = "epic";
  else if (r < 20) rarity = "rare";
  else if (r < 50) rarity = "uncommon";
  else rarity = "common";
  const pool = LOOT_TABLE.filter((i) => i.rarity === rarity && i.theme === theme);
  // Defensive fallback: if a theme is missing items at this rarity, pick from any theme.
  const finalPool = pool.length > 0 ? pool : LOOT_TABLE.filter((i) => i.rarity === rarity);
  return finalPool[Math.floor(Math.random() * finalPool.length)]!;
}

function upgradeRarity(r: Rarity): Rarity {
  const i = RARITY_ORDER.indexOf(r);
  return RARITY_ORDER[Math.min(i + 1, RARITY_ORDER.length - 1)]!;
}

export interface RollOptions {
  luckBuffActive: boolean;
  /** When false (settings: lootDropsEnabled), suppress buff/special-item rolls. */
  allowBuffs?: boolean;
  /** Theme for the item pool. Defaults to "goblin". */
  theme?: LootTheme;
}

/**
 * Roll a loot drop. With a small probability (and only when `allowBuffs` is
 * not explicitly false), roll a buff item instead of a plain sellable item.
 * With the luck buff active, has a 50% chance to bump the rarity one tier up
 * (and re-pick from that tier's pool).
 */
export function rollLootDrop(opts: RollOptions): RolledLoot {
  const allowBuffs = opts.allowBuffs !== false;
  const theme: LootTheme = opts.theme ?? "goblin";
  if (allowBuffs && Math.random() < BUFF_DROP_CHANCE) {
    const buff = BUFF_TABLE[Math.floor(Math.random() * BUFF_TABLE.length)]!;
    return {
      item: buff.item,
      rarity: buff.rarity,
      kind: "buff",
      buffEffect: buff.effect,
      coinValue: buff.coinValue,
      charges: buff.charges,
      flavor: buff.flavor,
    };
  }

  let base = baseRoll(theme);
  if (opts.luckBuffActive && Math.random() < 0.5) {
    const upRarity = upgradeRarity(base.rarity);
    if (upRarity !== base.rarity) {
      const pool = LOOT_TABLE.filter((i) => i.rarity === upRarity && i.theme === theme);
      const finalPool = pool.length > 0 ? pool : LOOT_TABLE.filter((i) => i.rarity === upRarity);
      base = finalPool[Math.floor(Math.random() * finalPool.length)]!;
    }
  }
  return {
    item: base.item,
    rarity: base.rarity,
    kind: "item",
    buffEffect: null,
    coinValue: base.points,
    charges: 0,
    flavor: getRarityEmoji(base.rarity),
  };
}

export interface AddItemResult {
  ok: boolean;
  reason?: "full";
  item?: UserInventoryItem;
  slot?: number;
  used: number;
  cap: number;
}

/**
 * Add a loot drop to a user's inventory. Serialized per (channel, username)
 * via a Postgres transaction-scoped advisory lock so concurrent !loot rolls
 * cannot exceed INVENTORY_CAP. If `consumeLuckOnSuccess` is true, the user's
 * active luck buff charge is consumed inside the same transaction — and only
 * if the insert actually happens, so a "full" result never burns the charge.
 */
export async function addInventoryItem(
  channel: string,
  username: string,
  loot: RolledLoot,
  opts: { consumeLuckOnSuccess?: boolean } = {}
): Promise<AddItemResult> {
  const ch = channel.replace(/^#/, "");
  const lockKey = `${ch}:${username}`;
  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existing = await tx
      .select()
      .from(userInventoryTable)
      .where(and(eq(userInventoryTable.channel, ch), eq(userInventoryTable.username, username)));
    if (existing.length >= INVENTORY_CAP) {
      return { ok: false, reason: "full" as const, used: existing.length, cap: INVENTORY_CAP };
    }
    const [inserted] = await tx
      .insert(userInventoryTable)
      .values({
        channel: ch,
        username,
        item: loot.item,
        rarity: loot.rarity,
        kind: loot.kind,
        buffEffect: loot.buffEffect,
        coinValue: loot.coinValue,
        chargesRemaining: loot.charges,
        isActive: false,
      })
      .returning();
    if (opts.consumeLuckOnSuccess) {
      const [buff] = await tx
        .select()
        .from(userInventoryTable)
        .where(
          and(
            eq(userInventoryTable.channel, ch),
            eq(userInventoryTable.username, username),
            eq(userInventoryTable.kind, "buff"),
            eq(userInventoryTable.buffEffect, "luck"),
            eq(userInventoryTable.isActive, true),
            sql`${userInventoryTable.chargesRemaining} > 0`
          )
        )
        .limit(1);
      if (buff) {
        const left = buff.chargesRemaining - 1;
        if (left <= 0) {
          await tx.delete(userInventoryTable).where(eq(userInventoryTable.id, buff.id));
        } else {
          await tx
            .update(userInventoryTable)
            .set({ chargesRemaining: left })
            .where(eq(userInventoryTable.id, buff.id));
        }
      }
    }
    return { ok: true, item: inserted!, slot: existing.length + 1, used: existing.length + 1, cap: INVENTORY_CAP };
  });
}

export async function listInventory(channel: string, username: string): Promise<UserInventoryItem[]> {
  const ch = channel.replace(/^#/, "");
  return await db
    .select()
    .from(userInventoryTable)
    .where(and(eq(userInventoryTable.channel, ch), eq(userInventoryTable.username, username)))
    .orderBy(userInventoryTable.acquiredAt);
}

export interface SellResult {
  ok: boolean;
  reason?: "not_found";
  item?: UserInventoryItem;
  coinsEarned?: number;
}

/**
 * Sell an inventory item. Atomic: deletes the row and inserts a loot_drops
 * coin-credit in the same txn. Applies any active "coins" buff multiplier and
 * consumes one of its charges.
 */
export async function sellInventoryItem(opts: {
  channel: string;
  username: string;
  itemId: number;
}): Promise<SellResult> {
  const ch = opts.channel.replace(/^#/, "");
  return await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(userInventoryTable)
      .where(
        and(
          eq(userInventoryTable.id, opts.itemId),
          eq(userInventoryTable.channel, ch),
          eq(userInventoryTable.username, opts.username)
        )
      )
      .limit(1);
    if (!item) return { ok: false, reason: "not_found" as const };

    let multiplier = 1;
    const [coinBuff] = await tx
      .select()
      .from(userInventoryTable)
      .where(
        and(
          eq(userInventoryTable.channel, ch),
          eq(userInventoryTable.username, opts.username),
          eq(userInventoryTable.kind, "buff"),
          eq(userInventoryTable.buffEffect, "coins"),
          eq(userInventoryTable.isActive, true)
        )
      )
      .limit(1);
    if (coinBuff && coinBuff.id !== item.id && coinBuff.chargesRemaining > 0) {
      multiplier = 2;
      const left = coinBuff.chargesRemaining - 1;
      if (left <= 0) {
        await tx.delete(userInventoryTable).where(eq(userInventoryTable.id, coinBuff.id));
      } else {
        await tx
          .update(userInventoryTable)
          .set({ chargesRemaining: left })
          .where(eq(userInventoryTable.id, coinBuff.id));
      }
    }

    const coinsEarned = item.coinValue * multiplier;
    await tx.delete(userInventoryTable).where(eq(userInventoryTable.id, item.id));
    await tx.insert(lootDropsTable).values({
      channel: ch,
      username: opts.username,
      item: `Sold: ${item.item}`,
      rarity: item.rarity,
      points: coinsEarned,
    });
    return { ok: true, item, coinsEarned };
  });
}

export interface UseResult {
  ok: boolean;
  reason?: "not_found" | "not_buff";
  item?: UserInventoryItem;
}

/**
 * Activate a buff item. Plain items (kind='item') cannot be used. If the user
 * already has another active buff of the same effect, that one is deactivated
 * (only one buff of each effect can be active at a time).
 */
export async function useInventoryItem(opts: {
  channel: string;
  username: string;
  itemId: number;
}): Promise<UseResult> {
  const ch = opts.channel.replace(/^#/, "");
  return await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(userInventoryTable)
      .where(
        and(
          eq(userInventoryTable.id, opts.itemId),
          eq(userInventoryTable.channel, ch),
          eq(userInventoryTable.username, opts.username)
        )
      )
      .limit(1);
    if (!item) return { ok: false, reason: "not_found" as const };
    if (item.kind !== "buff" || !item.buffEffect) return { ok: false, reason: "not_buff" as const, item };

    await tx
      .update(userInventoryTable)
      .set({ isActive: false })
      .where(
        and(
          eq(userInventoryTable.channel, ch),
          eq(userInventoryTable.username, opts.username),
          eq(userInventoryTable.kind, "buff"),
          eq(userInventoryTable.buffEffect, item.buffEffect),
          eq(userInventoryTable.isActive, true)
        )
      );

    const [updated] = await tx
      .update(userInventoryTable)
      .set({ isActive: true })
      .where(eq(userInventoryTable.id, item.id))
      .returning();
    return { ok: true, item: updated! };
  });
}

/**
 * Find an active buff with the given effect and consume one charge atomically.
 * Returns true if a charge was consumed (buff was active and had charges).
 */
export async function consumeBuffCharge(
  channel: string,
  username: string,
  effect: BuffEffect
): Promise<boolean> {
  const ch = channel.replace(/^#/, "");
  return await db.transaction(async (tx) => {
    const [buff] = await tx
      .select()
      .from(userInventoryTable)
      .where(
        and(
          eq(userInventoryTable.channel, ch),
          eq(userInventoryTable.username, username),
          eq(userInventoryTable.kind, "buff"),
          eq(userInventoryTable.buffEffect, effect),
          eq(userInventoryTable.isActive, true)
        )
      )
      .limit(1);
    if (!buff || buff.chargesRemaining <= 0) return false;
    const left = buff.chargesRemaining - 1;
    if (left <= 0) {
      await tx.delete(userInventoryTable).where(eq(userInventoryTable.id, buff.id));
    } else {
      await tx
        .update(userInventoryTable)
        .set({ chargesRemaining: left })
        .where(eq(userInventoryTable.id, buff.id));
    }
    return true;
  });
}

export async function hasActiveBuff(
  channel: string,
  username: string,
  effect: BuffEffect
): Promise<boolean> {
  const ch = channel.replace(/^#/, "");
  const [row] = await db
    .select({ id: userInventoryTable.id })
    .from(userInventoryTable)
    .where(
      and(
        eq(userInventoryTable.channel, ch),
        eq(userInventoryTable.username, username),
        eq(userInventoryTable.kind, "buff"),
        eq(userInventoryTable.buffEffect, effect),
        eq(userInventoryTable.isActive, true),
        sql`${userInventoryTable.chargesRemaining} > 0`
      )
    )
    .limit(1);
  return Boolean(row);
}

export function inventoryFullMessage(username: string): string {
  return `🎒 ${username}: Your goblin pouch is FULL (${INVENTORY_CAP}/${INVENTORY_CAP}). !sell something or !use a buff before grabbing more loot!`;
}

export { INVENTORY_CAP };

logger.debug({ buffs: BUFF_TABLE.length }, "Inventory module loaded");
