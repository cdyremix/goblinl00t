import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, customCommandsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  getCommandConfig,
  reloadCustomCommands,
  isBuiltInCommand,
  resolveCanonical,
  isCommandCustomizable,
  type CommandTheme,
} from "../bot/bot-service";
import { invalidateCommandResponses } from "../bot/command-responses";
import { invalidateCommandToggles } from "../bot/command-toggles";
import { userHasFeature } from "../lib/tier-helpers";

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
  res.json(await getCommandConfig({ channel, userId: user?.id }));
});

/**
 * Toggle a command on/off for the calling streamer's channel.
 *
 * - Built-in commands: the override is persisted in the streamer's
 *   `usersTable.commandToggles` JSONB (one entry per canonical name).
 *   Aliases share the canonical's toggle automatically because the bot
 *   chat handler resolves the canonical before consulting the toggle.
 *   The cache is invalidated so the next chat message sees the new state
 *   without a server restart.
 * - Custom commands: the streamer's row in `customCommandsTable` is
 *   updated (gated by `userId` so streamer A can never toggle streamer
 *   B's command). The chat-side cache is rebuilt via `reloadCustomCommands`.
 *
 * Requires a linked Twitch account because the toggle is keyed by channel.
 */
router.post("/commands/:name/toggle", async (req, res) => {
  const user = await getUserOrThrow(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const channel = user.twitchUsername?.trim().toLowerCase();
  if (!channel) { res.status(403).json({ error: "Connect your Twitch account first." }); return; }
  const name = normalizeName(req.params["name"] ?? "");

  // Built-in path
  if (isBuiltInCommand(name)) {
    const canonical = resolveCanonical(name) ?? name;
    const current = (user.commandToggles ?? {}) as Record<string, boolean>;
    const wasEnabled = typeof current[canonical] === "boolean" ? current[canonical]! : true;
    const next = { ...current, [canonical]: !wasEnabled };
    await db.update(usersTable).set({ commandToggles: next }).where(eq(usersTable.id, user.id));
    invalidateCommandToggles(channel);
    const all = await getCommandConfig({ channel, userId: user.id });
    const config = all.find((c) => c.name === canonical);
    res.json(config ?? { name: canonical, enabled: !wasEnabled, isCustom: false });
    return;
  }

  // Custom path — find by (userId, name) so cross-tenant toggles are impossible.
  const [row] = await db
    .select()
    .from(customCommandsTable)
    .where(and(eq(customCommandsTable.userId, user.id), eq(customCommandsTable.name, name)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Command not found" }); return; }
  await db
    .update(customCommandsTable)
    .set({ enabled: !row.enabled })
    .where(eq(customCommandsTable.id, row.id));
  await reloadCustomCommands();
  const all = await getCommandConfig({ channel, userId: user.id });
  const config = all.find((c) => c.name === name);
  res.json(config ?? { name, enabled: !row.enabled, isCustom: true });
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
  // Custom command responses are a Premium-tier feature. UI hides the
  // editor for free users via `hasFeature("custom-responses")`, but the
  // server is the actual entitlement boundary so curl can't bypass it.
  if (!userHasFeature(user, "custom-responses")) {
    res.status(403).json({ error: "Custom command responses require the Premium rank." });
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
  const all = await getCommandConfig({ channel: user.twitchUsername ?? undefined, userId: user.id });
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
