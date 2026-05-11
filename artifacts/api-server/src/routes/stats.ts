import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, usersTable } from "@workspace/db";
import { eq, desc, count, sum, sql, and, gte } from "drizzle-orm";
import { GetTopLootersQueryParams } from "@workspace/api-zod";
import { requireStreamerChannel } from "../lib/auth-helpers";
import { userHasFeature } from "../lib/tier-helpers";

const router: IRouter = Router();

type RangeKey = "day" | "week" | "month" | "year" | "all" | "stream";

/**
 * Resolve the start-time for a given filter window. `stream` returns the
 * caller's `streamStartedAt` (Operations → "Start Stream"); when no session
 * is active it falls back to the last 12h so the dashboard never shows an
 * empty state. `all` returns null (unbounded).
 */
async function resolveSince(req: Parameters<typeof getAuth>[0], range: RangeKey): Promise<Date | null> {
  const now = Date.now();
  switch (range) {
    case "day":   return new Date(now - 24 * 60 * 60 * 1000);
    case "week":  return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "month": return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "year":  return new Date(now - 365 * 24 * 60 * 60 * 1000);
    case "all":   return null;
    case "stream": {
      const { userId } = getAuth(req);
      if (userId) {
        const [user] = await db
          .select({ streamStartedAt: usersTable.streamStartedAt })
          .from(usersTable)
          .where(eq(usersTable.clerkUserId, userId))
          .limit(1);
        if (user?.streamStartedAt) return user.streamStartedAt;
      }
      // Fallback: last 12h so Operations isn't empty before the streamer
      // explicitly starts a session.
      return new Date(now - 12 * 60 * 60 * 1000);
    }
  }
}

function parseRange(raw: unknown): RangeKey {
  const v = String(raw ?? "all");
  if (v === "day" || v === "week" || v === "month" || v === "year" || v === "all" || v === "stream") return v;
  return "all";
}

router.get("/stats/overview", async (req, res) => {
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const lootWhere = since ? gte(lootDropsTable.droppedAt, since) : undefined;
  const cmdWhere = since ? gte(commandLogsTable.executedAt, since) : undefined;
  const givWhere = since ? gte(giveawaysTable.createdAt, since) : undefined;
  const entryWhere = since ? gte(giveawayEntriesTable.enteredAt, since) : undefined;

  const [totalGiveawaysRow] = givWhere
    ? await db.select({ count: count() }).from(giveawaysTable).where(givWhere)
    : await db.select({ count: count() }).from(giveawaysTable);
  const [activeGiveawayRow] = await db
    .select({ count: count() })
    .from(giveawaysTable)
    .where(eq(giveawaysTable.status, "active"));
  const [totalLootRow] = lootWhere
    ? await db.select({ count: count() }).from(lootDropsTable).where(lootWhere)
    : await db.select({ count: count() }).from(lootDropsTable);
  const [totalCommandsRow] = cmdWhere
    ? await db.select({ count: count() }).from(commandLogsTable).where(cmdWhere)
    : await db.select({ count: count() }).from(commandLogsTable);
  const [uniqueUsersRow] = lootWhere
    ? await db
        .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
        .from(lootDropsTable)
        .where(lootWhere)
    : await db
        .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
        .from(lootDropsTable);
  const [recentEntriesRow] = entryWhere
    ? await db.select({ count: count() }).from(giveawayEntriesTable).where(entryWhere)
    : await db.select({ count: count() }).from(giveawayEntriesTable);

  res.json({
    totalGiveaways: Number(totalGiveawaysRow?.count ?? 0),
    activeGiveaway: Number(activeGiveawayRow?.count ?? 0) > 0,
    totalLootDrops: Number(totalLootRow?.count ?? 0),
    totalCommandsUsed: Number(totalCommandsRow?.count ?? 0),
    uniqueUsers: Number(uniqueUsersRow?.count ?? 0),
    recentEntries: Number(recentEntriesRow?.count ?? 0),
    range,
    since: since?.toISOString() ?? null,
  });
});

router.get("/stats/commands", async (req, res) => {
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const baseSelect = {
    command: commandLogsTable.command,
    usageCount: count(),
    lastUsedAt: sql<string>`max(${commandLogsTable.executedAt})`,
  };
  const rows = since
    ? await db
        .select(baseSelect)
        .from(commandLogsTable)
        .where(gte(commandLogsTable.executedAt, since))
        .groupBy(commandLogsTable.command)
        .orderBy(desc(count()))
    : await db
        .select(baseSelect)
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
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const baseSelect = {
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
  };
  const rows = since
    ? await db
        .select(baseSelect)
        .from(lootDropsTable)
        .where(gte(lootDropsTable.droppedAt, since))
        .groupBy(lootDropsTable.username)
        .orderBy(desc(sum(lootDropsTable.points)))
        .limit(limit)
    : await db
        .select(baseSelect)
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

/**
 * Engagement tips: lightweight heuristics over the selected window.
 * Returns 0–5 actionable tips for streamers to lift chat participation.
 * Does not prescribe — these are suggestions, not auto-actions.
 */
router.get("/stats/engagement", async (req, res) => {
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const lootWhere = since ? gte(lootDropsTable.droppedAt, since) : undefined;
  const cmdWhere = since ? gte(commandLogsTable.executedAt, since) : undefined;
  const givWhere = since ? gte(giveawaysTable.createdAt, since) : undefined;

  const [lootCount] = lootWhere
    ? await db.select({ count: count() }).from(lootDropsTable).where(lootWhere)
    : await db.select({ count: count() }).from(lootDropsTable);
  const [cmdCount] = cmdWhere
    ? await db.select({ count: count() }).from(commandLogsTable).where(cmdWhere)
    : await db.select({ count: count() }).from(commandLogsTable);
  const [givCount] = givWhere
    ? await db.select({ count: count() }).from(giveawaysTable).where(givWhere)
    : await db.select({ count: count() }).from(giveawaysTable);
  const [uniqueRow] = lootWhere
    ? await db
        .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
        .from(lootDropsTable)
        .where(lootWhere)
    : await db
        .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
        .from(lootDropsTable);

  const totalLoot = Number(lootCount?.count ?? 0);
  const totalCmds = Number(cmdCount?.count ?? 0);
  const totalGiv = Number(givCount?.count ?? 0);
  const uniques = Number(uniqueRow?.count ?? 0);

  const tips: { id: string; severity: "info" | "warn"; title: string; detail: string }[] = [];

  if (totalGiv === 0) {
    tips.push({
      id: "no-giveaways",
      severity: "warn",
      title: "No giveaways in this window",
      detail: "Run a small giveaway (even 100 coins) to give viewers a reason to !enter and chat.",
    });
  }
  if (totalCmds < 10) {
    tips.push({
      id: "low-command-usage",
      severity: "info",
      title: "Chat commands are quiet",
      detail: "Pin a !commands message in chat or call out a fun one (!loot, !steal) on stream to get viewers exploring.",
    });
  }
  if (uniques < 5 && totalLoot > 0) {
    tips.push({
      id: "few-active-chatters",
      severity: "info",
      title: "Only a handful of chatters earned coins",
      detail: "Try a Quick Prize drop on a quiet viewer — it surfaces the bot to the rest of chat.",
    });
  }
  if (totalLoot === 0) {
    tips.push({
      id: "no-loot-drops",
      severity: "warn",
      title: "No loot has dropped",
      detail: "Make sure Loot Drops are enabled in Forge → Economy & Loot, then nudge chat with !loot.",
    });
  }
  if (totalCmds > 0 && totalLoot > 0 && uniques >= 5 && totalGiv >= 1) {
    tips.push({
      id: "healthy",
      severity: "info",
      title: "Engagement looks healthy",
      detail: "Consider saving your current giveaway as a preset so you can re-launch with one click next stream.",
    });
  }

  res.json({
    range,
    since: since?.toISOString() ?? null,
    metrics: {
      totalLoot,
      totalCommands: totalCmds,
      totalGiveaways: totalGiv,
      uniqueChatters: uniques,
    },
    tips,
  });
});

// Suppress unused-import warning for `and` (kept available for future joins).
void and;

/**
 * GET /stats/export?range=...&kind=loot|commands|giveaways
 * Returns a CSV of the chosen dataset for the chosen window.
 *
 * Why CSV: streamers asked for a "give me my numbers so I can put them in a
 * sponsorship deck" export. Three small queries cover the common asks
 * without standing up a full analytics export pipeline.
 *
 * Auth: scoped to the caller's own channel via `requireStreamerChannel`.
 * Multi-tenant deployments must NOT leak other streamers' rows here.
 */
router.get("/stats/export", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  // CSV export is gated behind `full-ledger-export` (Horde Master+).
  // The dashboard hides the button for free-tier users; this is the
  // server-side enforcement against direct API calls.
  if (!userHasFeature(ctx.user, "full-ledger-export")) {
    res.status(403).json({
      error: "CSV export is a Horde Master perk.",
      feature: "full-ledger-export",
    });
    return;
  }
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);
  const kind = String(req.query["kind"] ?? "loot");

  function csvCell(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  let header: string[];
  let rows: string[][];

  if (kind === "commands") {
    const channelFilter = eq(commandLogsTable.channel, ctx.channel);
    const where = since ? and(channelFilter, gte(commandLogsTable.executedAt, since)) : channelFilter;
    const data = await db
      .select()
      .from(commandLogsTable)
      .where(where)
      .orderBy(desc(commandLogsTable.executedAt))
      .limit(10000);
    header = ["executed_at", "channel", "username", "command"];
    rows = data.map((r) => [r.executedAt.toISOString(), r.channel, r.username, r.command]);
  } else if (kind === "giveaways") {
    const channelFilter = eq(giveawaysTable.channel, ctx.channel);
    const where = since ? and(channelFilter, gte(giveawaysTable.createdAt, since)) : channelFilter;
    const data = await db
      .select()
      .from(giveawaysTable)
      .where(where)
      .orderBy(desc(giveawaysTable.createdAt))
      .limit(10000);
    header = ["created_at", "ended_at", "channel", "title", "prize", "status", "winner", "prize_kind"];
    rows = data.map((r) => [
      r.createdAt.toISOString(),
      r.endedAt?.toISOString() ?? "",
      r.channel,
      r.title,
      r.prize,
      r.status,
      r.winnerUsername ?? "",
      r.prizeKind ?? "",
    ]);
  } else {
    const channelFilter = eq(lootDropsTable.channel, ctx.channel);
    const where = since ? and(channelFilter, gte(lootDropsTable.droppedAt, since)) : channelFilter;
    const data = await db
      .select()
      .from(lootDropsTable)
      .where(where)
      .orderBy(desc(lootDropsTable.droppedAt))
      .limit(10000);
    header = ["dropped_at", "channel", "username", "item", "rarity", "points"];
    rows = data.map((r) => [
      r.droppedAt.toISOString(),
      r.channel,
      r.username,
      r.item,
      r.rarity,
      String(r.points ?? 0),
    ]);
  }

  const body =
    [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") +
    "\n";

  const filename = `goblin-loot-${kind}-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
});

export default router;
