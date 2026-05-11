import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, giveawayPresetsTable, giveawaysTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const PresetInput = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  prize: z.string().min(1).max(160),
  prizeKind: z.enum(["cs2", "bot_item", "bot_coins"]).default("cs2"),
  prizeBotCoins: z.number().int().positive().optional(),
  prizeBotRarity: z.enum(["common", "uncommon", "rare", "epic", "legendary"]).optional(),
  keyword: z.string().min(1).max(40).default("!enter"),
  requireFollower: z.boolean().default(false),
  subscriberOnly: z.boolean().default(false),
  minSubTier: z.enum(["1000", "2000", "3000"]).optional(),
});

async function getCallerUser(req: Parameters<typeof getAuth>[0]) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  return user ?? null;
}

function serialize(p: typeof giveawayPresetsTable.$inferSelect) {
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? null,
    prize: p.prize,
    prizeKind: p.prizeKind as "cs2" | "bot_item" | "bot_coins",
    prizeBotCoins: p.prizeBotCoins ?? null,
    prizeBotRarity: p.prizeBotRarity ?? null,
    keyword: p.keyword,
    requireFollower: p.requireFollower,
    subscriberOnly: p.subscriberOnly,
    minSubTier: p.minSubTier ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/giveaway-presets", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select()
    .from(giveawayPresetsTable)
    .where(eq(giveawayPresetsTable.userId, user.id))
    .orderBy(desc(giveawayPresetsTable.createdAt));
  res.json(rows.map(serialize));
});

router.post("/giveaway-presets", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = PresetInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const channel = (user.twitchUsername ?? "goblinl00t").toLowerCase();
  const [row] = await db
    .insert(giveawayPresetsTable)
    .values({
      userId: user.id,
      channel,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      prize: parsed.data.prize,
      prizeKind: parsed.data.prizeKind,
      prizeBotCoins: parsed.data.prizeBotCoins ?? null,
      prizeBotRarity: parsed.data.prizeBotRarity ?? null,
      keyword: parsed.data.keyword,
      requireFollower: parsed.data.requireFollower,
      subscriberOnly: parsed.data.subscriberOnly,
      minSubTier: parsed.data.minSubTier ?? null,
    })
    .returning();
  res.status(201).json(serialize(row!));
});

router.delete("/giveaway-presets/:id", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .delete(giveawayPresetsTable)
    .where(and(eq(giveawayPresetsTable.id, id), eq(giveawayPresetsTable.userId, user.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

/**
 * Launch a preset = create a fresh `giveaways` row (status='pending') from
 * the preset's fields. The streamer still hits Start manually from the Loot
 * Hoard list (no auto-start, so the preset stays a template, not a scheduler).
 */
router.post("/giveaway-presets/:id/launch", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [preset] = await db
    .select()
    .from(giveawayPresetsTable)
    .where(and(eq(giveawayPresetsTable.id, id), eq(giveawayPresetsTable.userId, user.id)))
    .limit(1);
  if (!preset) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db
    .insert(giveawaysTable)
    .values({
      title: preset.title,
      prize: preset.prize,
      description: preset.description ?? null,
      prizeKind: preset.prizeKind,
      prizeBotCoins: preset.prizeBotCoins ?? null,
      prizeBotRarity: preset.prizeBotRarity ?? null,
      keyword: preset.keyword,
      channel: preset.channel,
      requireFollower: preset.requireFollower,
      subscriberOnly: preset.subscriberOnly,
      minSubTier: preset.minSubTier ?? null,
    })
    .returning();
  res.status(201).json({ giveawayId: row!.id, status: row!.status });
});

export default router;
