import { Router, type IRouter } from "express";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable } from "@workspace/db";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import { GetTopLootersQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats/overview", async (_req, res) => {
  const [totalGiveawaysRow] = await db.select({ count: count() }).from(giveawaysTable);
  const [activeGiveawayRow] = await db
    .select({ count: count() })
    .from(giveawaysTable)
    .where(eq(giveawaysTable.status, "active"));
  const [totalLootRow] = await db.select({ count: count() }).from(lootDropsTable);
  const [totalCommandsRow] = await db.select({ count: count() }).from(commandLogsTable);
  const [uniqueUsersRow] = await db
    .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
    .from(lootDropsTable);

  // Recent entries (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentEntriesRow] = await db
    .select({ count: count() })
    .from(giveawayEntriesTable)
    .where(sql`${giveawayEntriesTable.enteredAt} > ${oneDayAgo}`);

  res.json({
    totalGiveaways: Number(totalGiveawaysRow?.count ?? 0),
    activeGiveaway: Number(activeGiveawayRow?.count ?? 0) > 0,
    totalLootDrops: Number(totalLootRow?.count ?? 0),
    totalCommandsUsed: Number(totalCommandsRow?.count ?? 0),
    uniqueUsers: Number(uniqueUsersRow?.count ?? 0),
    recentEntries: Number(recentEntriesRow?.count ?? 0),
  });
});

router.get("/stats/commands", async (_req, res) => {
  const rows = await db
    .select({
      command: commandLogsTable.command,
      usageCount: count(),
      lastUsedAt: sql<string>`max(${commandLogsTable.executedAt})`,
    })
    .from(commandLogsTable)
    .groupBy(commandLogsTable.command)
    .orderBy(desc(count()));

  res.json(
    rows.map((r) => ({
      command: r.command,
      usageCount: Number(r.usageCount),
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
    }))
  );
});

router.get("/stats/top-looters", async (req, res) => {
  const query = GetTopLootersQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 10) : 10;

  const rows = await db
    .select({
      username: lootDropsTable.username,
      lootCount: count(),
      totalPoints: sum(lootDropsTable.points),
      bestRarity: sql<string>`
        CASE
          WHEN bool_or(${lootDropsTable.rarity} = 'legendary') THEN 'legendary'
          WHEN bool_or(${lootDropsTable.rarity} = 'epic') THEN 'epic'
          WHEN bool_or(${lootDropsTable.rarity} = 'rare') THEN 'rare'
          WHEN bool_or(${lootDropsTable.rarity} = 'uncommon') THEN 'uncommon'
          ELSE 'common'
        END
      `,
    })
    .from(lootDropsTable)
    .groupBy(lootDropsTable.username)
    .orderBy(desc(sum(lootDropsTable.points)))
    .limit(limit);

  res.json(
    rows.map((r) => ({
      username: r.username,
      lootCount: Number(r.lootCount),
      totalPoints: Number(r.totalPoints ?? 0),
      bestRarity: r.bestRarity,
    }))
  );
});

export default router;
