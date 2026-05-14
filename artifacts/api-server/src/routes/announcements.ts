import { Router, type IRouter } from "express";
import { db, scheduledAnnouncementsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireStreamerChannel } from "../lib/auth-helpers";

const router: IRouter = Router();

const CreateSchema = z.object({
  message: z.string().min(1).max(500),
  intervalMinutes: z.number().int().min(1).max(1440).default(30),
  enabled: z.boolean().default(true),
});

const PatchSchema = z.object({
  message: z.string().min(1).max(500).optional(),
  intervalMinutes: z.number().int().min(1).max(1440).optional(),
  enabled: z.boolean().optional(),
});

function serializeAnnouncement(row: typeof scheduledAnnouncementsTable.$inferSelect) {
  return {
    id: row.id,
    channel: row.channel,
    message: row.message,
    intervalMinutes: row.intervalMinutes,
    enabled: row.enabled,
    lastPostedAt: row.lastPostedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/announcements", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(scheduledAnnouncementsTable)
    .where(eq(scheduledAnnouncementsTable.channel, ctx.channel));
  res.json(rows.map(serializeAnnouncement));
});

router.post("/announcements", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
    return;
  }
  const [row] = await db
    .insert(scheduledAnnouncementsTable)
    .values({ channel: ctx.channel, ...parsed.data })
    .returning();
  res.status(201).json(serializeAnnouncement(row!));
});

router.patch("/announcements/:id", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
    return;
  }
  const [row] = await db
    .update(scheduledAnnouncementsTable)
    .set(parsed.data)
    .where(
      and(
        eq(scheduledAnnouncementsTable.id, id),
        eq(scheduledAnnouncementsTable.channel, ctx.channel),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeAnnouncement(row));
});

router.delete("/announcements/:id", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(scheduledAnnouncementsTable)
    .where(
      and(
        eq(scheduledAnnouncementsTable.id, id),
        eq(scheduledAnnouncementsTable.channel, ctx.channel),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
