import { Router, type IRouter } from "express";
import { db, lootDropsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { GetRecentLootQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/loot/recent", async (req, res) => {
  const query = GetRecentLootQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;

  const drops = await db
    .select()
    .from(lootDropsTable)
    .orderBy(desc(lootDropsTable.droppedAt))
    .limit(limit);

  res.json(
    drops.map((d) => ({
      id: d.id,
      username: d.username,
      item: d.item,
      rarity: d.rarity,
      points: d.points,
      channel: d.channel,
      droppedAt: d.droppedAt.toISOString(),
    }))
  );
});

export default router;
