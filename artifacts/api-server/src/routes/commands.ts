import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, customCommandsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  getCommandConfig,
  toggleCommandEnabled,
  reloadCustomCommands,
  isBuiltInCommand,
  resolveCanonical,
  isCommandCustomizable,
  type CommandTheme,
} from "../bot/bot-service";
import { invalidateCommandResponses } from "../bot/command-responses";

const router: IRouter = Router();

const VALID_THEMES: CommandTheme[] = ["goblin", "cs2", "both"];

const NameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^!?[a-z0-9_]+$/i, "Use letters, numbers, and underscores only (optional leading !)");

const CustomCommandInput = z.object({
  name: NameSchema,
  responseText: z.string().min(1).max(400),
  cooldownSeconds: z.number().int().min(0).max(3600).default(10),
  enabled: z.boolean().default(true),
  theme: z.enum(["goblin", "cs2", "both"]).default("both"),
});

const CustomCommandPatch = z.object({
  responseText: z.string().min(1).max(400).optional(),
  cooldownSeconds: z.number().int().min(0).max(3600).optional(),
  enabled: z.boolean().optional(),
  theme: z.enum(["goblin", "cs2", "both"]).optional(),
});

function normalizeName(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith("!") ? trimmed : `!${trimmed}`;
}

async function getUserOrThrow(req: any) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId)).limit(1);
  return user ?? null;
}

router.get("/commands", async (req, res) => {
  const user = await getUserOrThrow(req);
  const channel = user?.twitchUsername ?? undefined;
  res.json(await getCommandConfig({ channel }));
});

router.post("/commands/:name/toggle", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const name = normalizeName(req.params["name"] ?? "");
  try {
    const enabled = toggleCommandEnabled(name);
    const all = await getCommandConfig({ channel: user.twitchUsername ?? undefined });
    const config = all.find((c) => c.name === name);
    res.json(config ?? { name, description: "", enabled, cooldownSeconds: 10, theme: "both", isCustom: false });
  } catch {
    res.status(404).json({ error: "Command not found" });
  }
});

const ResponseInput = z.object({
  // Empty/whitespace clears the override and falls back to the default.
  response: z.string().max(400),
});

router.put("/commands/:name/response", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const name = normalizeName(req.params["name"] ?? "");
  const canonical = resolveCanonical(name);
  if (!canonical || !isCommandCustomizable(canonical)) {
    res.status(400).json({ error: `${name} cannot be customized` });
    return;
  }
  const parsed = ResponseInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const trimmed = parsed.data.response.trim();
  const current: Record<string, string> = (user.commandResponses ?? {}) as Record<string, string>;
  const next = { ...current };
  if (trimmed.length === 0) {
    delete next[canonical];
  } else {
    next[canonical] = trimmed;
  }
  await db.update(usersTable).set({ commandResponses: next }).where(eq(usersTable.id, user.id));
  if (user.twitchUsername) invalidateCommandResponses(user.twitchUsername);
  const all = await getCommandConfig({ channel: user.twitchUsername ?? undefined });
  const config = all.find((c) => c.name === canonical);
  res.json(config ?? { name: canonical, customResponse: trimmed || null });
});

// ---- Custom commands ----

router.post("/custom-commands", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CustomCommandInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const name = normalizeName(parsed.data.name);
  if (isBuiltInCommand(name)) {
    res.status(400).json({ error: `${name} is a built-in command` });
    return;
  }
  try {
    const [row] = await db.insert(customCommandsTable).values({
      userId: user.id,
      name,
      responseText: parsed.data.responseText,
      cooldownSeconds: parsed.data.cooldownSeconds,
      enabled: parsed.data.enabled,
      theme: parsed.data.theme,
    }).returning();
    await reloadCustomCommands();
    res.json(row);
  } catch (err: any) {
    if (String(err?.message ?? "").includes("unique")) {
      res.status(409).json({ error: `Command ${name} already exists` });
      return;
    }
    res.status(500).json({ error: "Failed to create command" });
  }
});

router.put("/custom-commands/:id", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CustomCommandPatch.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [row] = await db
    .update(customCommandsTable)
    .set(parsed.data)
    .where(and(eq(customCommandsTable.id, id), eq(customCommandsTable.userId, user.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await reloadCustomCommands();
  res.json(row);
});

router.delete("/custom-commands/:id", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .delete(customCommandsTable)
    .where(and(eq(customCommandsTable.id, id), eq(customCommandsTable.userId, user.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await reloadCustomCommands();
  res.json({ success: true });
});

// Mark VALID_THEMES as referenced (used for runtime validation by callers if needed).
void VALID_THEMES;

export default router;
