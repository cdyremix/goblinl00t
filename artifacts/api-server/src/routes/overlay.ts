import { Router, type IRouter } from "express";
import { db, lootDropsTable, giveawaysTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Public overlay feed — no authentication required.
 * Powers OBS browser-source overlays. Returns recent loot drops + giveaway
 * winners for a channel so streamers can embed a live loot ticker in OBS.
 */
router.get("/overlay/:channel/feed", async (req, res) => {
  const channel = (req.params["channel"] as string).toLowerCase().replace(/^#/, "");
  if (!channel) { res.status(400).json({ error: "channel required" }); return; }

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000); // last hour

    const [recentDrops, recentWinners] = await Promise.all([
      db
        .select({
          id: lootDropsTable.id,
          username: lootDropsTable.username,
          item: lootDropsTable.item,
          rarity: lootDropsTable.rarity,
          points: lootDropsTable.points,
          droppedAt: lootDropsTable.droppedAt,
        })
        .from(lootDropsTable)
        .where(and(eq(lootDropsTable.channel, channel), gte(lootDropsTable.droppedAt, since)))
        .orderBy(desc(lootDropsTable.droppedAt))
        .limit(20),
      db
        .select({
          id: giveawaysTable.id,
          title: giveawaysTable.title,
          prize: giveawaysTable.prize,
          winnerUsername: giveawaysTable.winnerUsername,
          endedAt: giveawaysTable.endedAt,
        })
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.channel, channel), eq(giveawaysTable.status, "ended")))
        .orderBy(desc(giveawaysTable.endedAt))
        .limit(5),
    ]);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({ channel, recentDrops, recentWinners });
  } catch (err) {
    logger.error({ err, channel }, "overlay feed error");
    res.status(500).json({ error: "failed to load feed" });
  }
});

export default router;
