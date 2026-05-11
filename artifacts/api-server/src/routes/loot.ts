import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, lootDropsTable, usersTable } from "@workspace/db";
import { desc, gte, eq } from "drizzle-orm";
import { GetRecentLootQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/loot/recent", async (req, res) => {
  const query = GetRecentLootQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;

  // Optional `since` filter — `stream` resolves to the caller's
  // `streamStartedAt` (falling back to last 12h when no session is open).
  // `day|week|month|year` uses fixed windows. Default = unbounded.
  const sinceParam = String(req.query["since"] ?? "");
  let since: Date | null = null;
  const now = Date.now();
  if (sinceParam === "day")   since = new Date(now - 24 * 60 * 60 * 1000);
  else if (sinceParam === "week")  since = new Date(now - 7 * 24 * 60 * 60 * 1000);
  else if (sinceParam === "month") since = new Date(now - 30 * 24 * 60 * 60 * 1000);
  else if (sinceParam === "year")  since = new Date(now - 365 * 24 * 60 * 60 * 1000);
  else if (sinceParam === "stream") {
    const { userId } = getAuth(req);
    if (userId) {
      const [user] = await db
        .select({ streamStartedAt: usersTable.streamStartedAt })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, userId))
        .limit(1);
      since = user?.streamStartedAt ?? new Date(now - 12 * 60 * 60 * 1000);
    } else {
      since = new Date(now - 12 * 60 * 60 * 1000);
    }
  }

  const rows = since
    ? await db
        .select()
        .from(lootDropsTable)
        .where(gte(lootDropsTable.droppedAt, since))
        .orderBy(desc(lootDropsTable.droppedAt))
        .limit(limit)
    : await db
        .select()
        .from(lootDropsTable)
        .orderBy(desc(lootDropsTable.droppedAt))
        .limit(limit);

  res.json(
    rows.map((d) => ({
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
