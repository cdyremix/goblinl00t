import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, usersTable } from "@workspace/db";
import { eq, desc, count, sum, sql, and, gte, inArray } from "drizzle-orm";
import { GetTopLootersQueryParams } from "@workspace/api-zod";
import { requireStreamerChannel, resolveStreamerChannelForRead } from "../lib/auth-helpers";
import { userHasFeature } from "../lib/tier-helpers";
import { openai } from "@workspace/integrations-openai-ai-server";

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

// All aggregate stats endpoints scope to the caller's own channel via
// `resolveStreamerChannelForRead` (dev fallback to `goblinl00t` for
// not-yet-Twitch-linked accounts; production requires a linked Twitch).
// The legacy global aggregate behaviour leaked totals across streamers
// once a second tenant signed up.

router.get("/stats/overview", async (req, res) => {
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const lootChan = eq(lootDropsTable.channel, ctx.channel);
  const cmdChan = eq(commandLogsTable.channel, ctx.channel);
  const givChan = eq(giveawaysTable.channel, ctx.channel);

  const lootWhere = since ? and(lootChan, gte(lootDropsTable.droppedAt, since)) : lootChan;
  const cmdWhere = since ? and(cmdChan, gte(commandLogsTable.executedAt, since)) : cmdChan;
  const givWhere = since ? and(givChan, gte(giveawaysTable.createdAt, since)) : givChan;

  const [totalGiveawaysRow] = await db.select({ count: count() }).from(giveawaysTable).where(givWhere);
  const [activeGiveawayRow] = await db
    .select({ count: count() })
    .from(giveawaysTable)
    .where(and(givChan, eq(giveawaysTable.status, "active")));
  const [totalLootRow] = await db.select({ count: count() }).from(lootDropsTable).where(lootWhere);
  const [totalCommandsRow] = await db.select({ count: count() }).from(commandLogsTable).where(cmdWhere);
  const [uniqueUsersRow] = await db
    .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
    .from(lootDropsTable)
    .where(lootWhere);

  // Recent entries are scoped to giveaways belonging to this channel —
  // join via `inArray` over the channel's giveaway ids in the window.
  const channelGivWhere = since
    ? and(givChan, gte(giveawaysTable.createdAt, since))
    : givChan;
  const channelGivIds = await db
    .select({ id: giveawaysTable.id })
    .from(giveawaysTable)
    .where(channelGivWhere);
  const ids = channelGivIds.map((r) => r.id);
  const recentEntriesCount = ids.length
    ? Number(
        (
          await db
            .select({ count: count() })
            .from(giveawayEntriesTable)
            .where(inArray(giveawayEntriesTable.giveawayId, ids))
        )[0]?.count ?? 0,
      )
    : 0;

  res.json({
    totalGiveaways: Number(totalGiveawaysRow?.count ?? 0),
    activeGiveaway: Number(activeGiveawayRow?.count ?? 0) > 0,
    totalLootDrops: Number(totalLootRow?.count ?? 0),
    totalCommandsUsed: Number(totalCommandsRow?.count ?? 0),
    uniqueUsers: Number(uniqueUsersRow?.count ?? 0),
    recentEntries: recentEntriesCount,
    range,
    since: since?.toISOString() ?? null,
  });
});

router.get("/stats/commands", async (req, res) => {
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const channelFilter = eq(commandLogsTable.channel, ctx.channel);
  const where = since ? and(channelFilter, gte(commandLogsTable.executedAt, since)) : channelFilter;

  const rows = await db
    .select({
      command: commandLogsTable.command,
      usageCount: count(),
      lastUsedAt: sql<string>`max(${commandLogsTable.executedAt})`,
    })
    .from(commandLogsTable)
    .where(where)
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
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const query = GetTopLootersQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 10) : 10;
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const channelFilter = eq(lootDropsTable.channel, ctx.channel);
  const where = since ? and(channelFilter, gte(lootDropsTable.droppedAt, since)) : channelFilter;

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
    .where(where)
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
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const lootChan = eq(lootDropsTable.channel, ctx.channel);
  const cmdChan = eq(commandLogsTable.channel, ctx.channel);
  const givChan = eq(giveawaysTable.channel, ctx.channel);
  const lootWhere = since ? and(lootChan, gte(lootDropsTable.droppedAt, since)) : lootChan;
  const cmdWhere = since ? and(cmdChan, gte(commandLogsTable.executedAt, since)) : cmdChan;
  const givWhere = since ? and(givChan, gte(giveawaysTable.createdAt, since)) : givChan;

  const [lootCount] = await db.select({ count: count() }).from(lootDropsTable).where(lootWhere);
  const [cmdCount] = await db.select({ count: count() }).from(commandLogsTable).where(cmdWhere);
  const [givCount] = await db.select({ count: count() }).from(giveawaysTable).where(givWhere);
  const [uniqueRow] = await db
    .select({ count: sql<number>`count(distinct ${lootDropsTable.username})` })
    .from(lootDropsTable)
    .where(lootWhere);

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

/**
 * Simple in-memory cache for AI reports — keyed by `channel:range`.
 * Avoids hammering the LLM on every page refresh; entries expire after 10 min.
 */
const aiReportCache = new Map<string, { data: object; expiresAt: number }>();

/**
 * GET /stats/ai-report?range=... — AI-generated engagement + monetization
 * report for the caller's channel. Gated to `advanced-analytics` (pro tier).
 */
router.get("/stats/ai-report", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;

  if (!userHasFeature(ctx.user, "advanced-analytics")) {
    res.status(403).json({
      error: "AI reports are a Goblin King (pro) perk.",
      feature: "advanced-analytics",
    });
    return;
  }

  const range = parseRange(req.query["range"]);
  const since = await resolveSince(req, range);

  const cacheKey = `${ctx.channel}:${range}`;
  const cached = aiReportCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json({ ...cached.data, cached: true });
    return;
  }

  const lootChan = eq(lootDropsTable.channel, ctx.channel);
  const cmdChan  = eq(commandLogsTable.channel, ctx.channel);
  const givChan  = eq(giveawaysTable.channel, ctx.channel);
  const lootWhere = since ? and(lootChan, gte(lootDropsTable.droppedAt, since)) : lootChan;
  const cmdWhere  = since ? and(cmdChan, gte(commandLogsTable.executedAt, since)) : cmdChan;
  const givWhere  = since ? and(givChan, gte(giveawaysTable.createdAt, since)) : givChan;

  const [[lootRow], [cmdRow], [givRow], [uniqueRow], topLooters, topCmds] = await Promise.all([
    db.select({ count: count() }).from(lootDropsTable).where(lootWhere),
    db.select({ count: count() }).from(commandLogsTable).where(cmdWhere),
    db.select({ count: count() }).from(giveawaysTable).where(givWhere),
    db.select({ count: sql<number>`count(distinct ${lootDropsTable.username})` }).from(lootDropsTable).where(lootWhere),
    db.select({
      username: lootDropsTable.username,
      totalPoints: sum(lootDropsTable.points),
      lootCount: count(),
    }).from(lootDropsTable).where(lootWhere).groupBy(lootDropsTable.username)
      .orderBy(desc(sum(lootDropsTable.points))).limit(5),
    db.select({ command: commandLogsTable.command, usageCount: count() })
      .from(commandLogsTable).where(cmdWhere).groupBy(commandLogsTable.command)
      .orderBy(desc(count())).limit(5),
  ]);

  const metrics = {
    lootDrops: Number(lootRow?.count ?? 0),
    commandsFired: Number(cmdRow?.count ?? 0),
    giveaways: Number(givRow?.count ?? 0),
    uniqueChatters: Number(uniqueRow?.count ?? 0),
    topLooters: topLooters.map((r) => ({ username: r.username, coins: Number(r.totalPoints ?? 0), drops: Number(r.lootCount) })),
    topCommands: topCmds.map((r) => ({ command: r.command, uses: Number(r.usageCount) })),
    range,
    channel: ctx.channel,
  };

  const prompt = `You are a Twitch stream growth advisor specializing in chat engagement and monetization for Goblin L00t — a loot-drop and giveaway bot.

Analyze the following stream statistics for the Twitch channel "${ctx.channel}" over the "${range}" period:
- Loot drops: ${metrics.lootDrops}
- Commands fired: ${metrics.commandsFired}
- Giveaways run: ${metrics.giveaways}
- Unique chatters who earned coins: ${metrics.uniqueChatters}
- Top 5 chatters by coins: ${metrics.topLooters.map((u) => `${u.username} (${u.coins} coins, ${u.drops} drops)`).join(", ") || "none"}
- Top 5 commands used: ${metrics.topCommands.map((c) => `${c.command} (${c.uses}x)`).join(", ") || "none"}

Return a JSON object with this exact structure (no markdown, no code fences — raw JSON only):
{
  "report": "<2-3 sentence executive summary of the channel's engagement health>",
  "sections": [
    {
      "title": "<short section title>",
      "insight": "<specific observation about what the data shows>",
      "action": "<concrete 1-2 sentence action the streamer should take>"
    }
  ]
}

Generate 3-5 sections covering: engagement trends, top performer recognition, command/giveaway optimization, and monetization opportunities. Be specific, actionable, and encouraging. Focus on what's working and what quick wins are available.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { report?: string; sections?: Array<{ title: string; insight: string; action: string }> };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = { report: raw, sections: [] };
    }

    const result = {
      report: parsed.report ?? "Unable to generate report at this time.",
      sections: parsed.sections ?? [],
      generatedAt: new Date().toISOString(),
      range,
      cached: false,
    };

    aiReportCache.set(cacheKey, { data: result, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json(result);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (errMessage.includes("AI_INTEGRATIONS_OPENAI_BASE_URL") || errMessage.includes("AI_INTEGRATIONS_OPENAI_API_KEY")) {
      req.log.warn({ errMessage }, "AI report unavailable: OpenAI integration not configured");
      res.status(503).json({ error: "AI reports are not available in this environment. The OpenAI integration is only active on Replit-hosted deployments." });
      return;
    }
    req.log.error({ errMessage }, "AI report generation failed");
    res.status(500).json({ error: "Failed to generate AI report. Try again in a moment." });
  }
});

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

router.get("/stats/retention", async (req, res) => {
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;

  const channel = ctx.channel;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [recentRows, prevRows] = await Promise.all([
    db.selectDistinct({ username: lootDropsTable.username })
      .from(lootDropsTable)
      .where(and(eq(lootDropsTable.channel, channel), gte(lootDropsTable.droppedAt, sevenDaysAgo))),
    db.selectDistinct({ username: lootDropsTable.username })
      .from(lootDropsTable)
      .where(and(
        eq(lootDropsTable.channel, channel),
        gte(lootDropsTable.droppedAt, fourteenDaysAgo),
        sql`${lootDropsTable.droppedAt} < ${sevenDaysAgo}`,
      )),
  ]);

  const recentSet = new Set(recentRows.map((r) => r.username));
  const prevSet = new Set(prevRows.map((r) => r.username));
  const totalActiveViewers = recentSet.size;
  const returningViewers = [...recentSet].filter((u) => prevSet.has(u)).length;
  const retentionRate = totalActiveViewers > 0 ? Math.round((returningViewers / totalActiveViewers) * 100) : 0;

  res.json({ returningViewers, totalActiveViewers, retentionRate, period: "7 days" });
});

/**
 * GET /stats/stream-info
 * Returns live Twitch stream data for the authenticated user's channel
 * using the bot OAuth token. Falls back gracefully when not configured or offline.
 */
router.get("/stream-info", async (req, res) => {
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const channel = ctx.channel;

  const clientId = process.env["TWITCH_CLIENT_ID"] ?? "";
  const oauthToken = process.env["TWITCH_OAUTH_TOKEN"] ?? "";

  if (!clientId || !oauthToken) {
    res.json({ isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null });
    return;
  }

  try {
    const r = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`,
      {
        headers: {
          "Client-Id": clientId,
          "Authorization": `Bearer ${oauthToken}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!r.ok) {
      res.json({ isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null });
      return;
    }

    const json = await r.json() as {
      data?: Array<{ viewer_count: number; title: string; game_name: string; started_at: string }>;
    };
    const stream = json.data?.[0];

    if (!stream) {
      res.json({ isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null });
      return;
    }

    res.json({
      isLive: true,
      viewerCount: stream.viewer_count ?? null,
      title: stream.title ?? null,
      gameName: stream.game_name ?? null,
      startedAt: stream.started_at ?? null,
    });
  } catch {
    res.json({ isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null });
  }
});

export default router;
