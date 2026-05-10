import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setActiveTheme, type BotTheme } from "../bot/bot-themes";

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
    .values({ clerkUserId, subscriptionTier: "free" })
    .returning();
  return created!;
}

router.get("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getOrCreateUser(userId);
  res.json({
    botTheme: user.botTheme as BotTheme,
    steamTradeUrl: user.steamTradeUrl ?? null,
  });
});

router.put("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body as { botTheme?: string; steamTradeUrl?: string | null };

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (body.botTheme !== undefined) {
    if (!VALID_THEMES.includes(body.botTheme as BotTheme)) {
      res.status(400).json({ error: "Invalid theme. Must be one of: goblin, cs2" });
      return;
    }
    updates.botTheme = body.botTheme;
    setActiveTheme(body.botTheme as BotTheme);
  }

  if ("steamTradeUrl" in body) {
    updates.steamTradeUrl = body.steamTradeUrl ?? null;
  }

  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.clerkUserId, userId))
    .returning();

  res.json({
    botTheme: updated!.botTheme as BotTheme,
    steamTradeUrl: updated!.steamTradeUrl ?? null,
  });
});

export default router;
