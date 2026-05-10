import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setActiveTheme, type BotTheme } from "../bot/bot-themes";
import { setActiveBotName } from "../bot/bot-service";

const router = Router();

const VALID_THEMES: BotTheme[] = ["goblin", "cs2"];

async function getOrCreateUser(clerkUserId: string) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(usersTable)
    .values({ clerkUserId, subscriptionTier: "premium" })
    .returning();
  return created!;
}

function serializeSettings(user: typeof usersTable.$inferSelect) {
  return {
    botTheme: user.botTheme as BotTheme,
    botName: user.botName,
    steamTradeUrl: user.steamTradeUrl ?? null,
    steamId64: user.steamId64 ?? null,
    steamUsername: user.steamUsername ?? null,
  };
}

router.get("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getOrCreateUser(userId);
  res.json(serializeSettings(user));
});

router.put("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body as {
    botTheme?: string;
    botName?: string;
    steamTradeUrl?: string | null;
    steamId64?: string | null;
    steamUsername?: string | null;
  };

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (body.botTheme !== undefined) {
    if (!VALID_THEMES.includes(body.botTheme as BotTheme)) {
      res.status(400).json({ error: "Invalid theme. Must be: goblin or cs2" });
      return;
    }
    updates.botTheme = body.botTheme;
    setActiveTheme(body.botTheme as BotTheme);
  }

  if (body.botName !== undefined) {
    const name = body.botName.trim();
    if (!name || name.length > 32) {
      res.status(400).json({ error: "Bot name must be 1–32 characters" });
      return;
    }
    updates.botName = name;
    setActiveBotName(name);
  }

  if ("steamTradeUrl" in body) updates.steamTradeUrl = body.steamTradeUrl ?? null;
  if ("steamId64" in body) updates.steamId64 = body.steamId64 ?? null;
  if ("steamUsername" in body) updates.steamUsername = body.steamUsername ?? null;

  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.clerkUserId, userId))
    .returning();

  res.json(serializeSettings(updated!));
});

export default router;
