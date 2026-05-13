import { Router } from "express";
import { db, supportTicketsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../lib/auth-helpers";

const router = Router();

const SubmitTicketBody = z.object({
  email: z.string().email("Valid email required.").max(254),
  category: z.enum(["bug", "feature", "help", "other"]),
  subject: z.string().min(3, "Subject must be at least 3 characters.").max(120),
  message: z.string().min(10, "Message must be at least 10 characters.").max(4000),
});

/**
 * POST /support/tickets
 * Submit a support ticket or feedback item. Clerk auth is optional —
 * if the caller is signed in we capture their userId and twitchUsername
 * automatically; otherwise just email + content.
 */
router.post("/support/tickets", async (req, res) => {
  const parsed = SubmitTicketBody.safeParse(req.body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    res.status(400).json({ error: "Validation failed", fields });
    return;
  }

  const { email, category, subject, message } = parsed.data;

  const { userId } = getAuth(req);
  let twitchUsername: string | null = null;

  if (userId) {
    const [user] = await db
      .select({ twitchUsername: usersTable.twitchUsername })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, userId))
      .limit(1)
      .catch(() => []);
    twitchUsername = user?.twitchUsername ?? null;
  }

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({ clerkUserId: userId ?? null, email, twitchUsername, category, subject, message })
    .returning({ id: supportTicketsTable.id });

  req.log.info({ ticketId: ticket.id, category }, "support ticket submitted");
  res.status(201).json({ id: ticket.id });
});

/**
 * GET /admin/support/tickets
 * List all support tickets, newest first.
 */
router.get("/admin/support/tickets", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .orderBy(desc(supportTicketsTable.createdAt));

  res.json({ tickets });
});

const UpdateTicketBody = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  adminNote: z.string().max(2000).optional().nullable(),
});

/**
 * PATCH /admin/support/tickets/:id
 * Update status and/or admin note on a ticket.
 */
router.patch("/admin/support/tickets/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const parsed = UpdateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.adminNote !== undefined) updates.adminNote = parsed.data.adminNote;

  const [ticket] = await db
    .update(supportTicketsTable)
    .set(updates)
    .where(eq(supportTicketsTable.id, id))
    .returning();

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json({ ticket });
});

export default router;
