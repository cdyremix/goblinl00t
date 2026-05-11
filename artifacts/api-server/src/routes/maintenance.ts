import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, waitlistEmailsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rateLimit } from "../lib/auth-helpers";
import { getMaintenanceEnabled } from "../lib/maintenance-state";

const router = Router();

/**
 * GET /maintenance/status — public, no auth required.
 *
 * Returns whether the app is currently in maintenance mode AND, when a
 * Clerk session is present, whether the caller is a super-user (so the
 * frontend can let admins bypass the wall and continue testing). The
 * isAdmin flag is intentionally derived server-side from the DB row,
 * not trusted from any client claim.
 */
router.get("/maintenance/status", async (req, res) => {
  const enabled = await getMaintenanceEnabled();
  let isAdmin = false;
  let isDev = false;
  try {
    const { userId } = getAuth(req);
    if (userId) {
      const [row] = await db
        .select({ isAdmin: usersTable.isAdmin, isDev: usersTable.isDev })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, userId))
        .limit(1);
      isAdmin = !!row?.isAdmin;
      isDev = !!row?.isDev;
    }
  } catch {
    // Auth resolution is best-effort — anonymous callers (or a Clerk
    // session lookup hiccup) just default to non-admin and see the wall.
  }
  res.json({ enabled, isAdmin, isDev });
});

/**
 * POST /waitlist — public, no auth required.
 *
 * Captures an email for the launch announcement list. Idempotent on
 * `email` via `onConflictDoNothing`; we always respond `{ ok: true }`
 * so a probe can't enumerate which addresses are already signed up.
 *
 * Rate-limited per source IP to soak up bot traffic (the field is
 * public — no Clerk gate).
 */
router.post("/waitlist", async (req, res) => {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "anon").toString();
  if (!rateLimit(`waitlist:${ip}`, { max: 5, windowMs: 60_000 })) {
    res.status(429).json({ error: "Too many requests. Try again in a minute." });
    return;
  }

  const body = req.body as { email?: unknown; source?: unknown };
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // Conservative RFC-ish email check — generous enough for real users,
  // strict enough to drop the obvious junk a bot would post.
  const emailValid =
    rawEmail.length > 0 &&
    rawEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
  if (!emailValid) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  const source =
    typeof body.source === "string" && body.source.length <= 64
      ? body.source
      : "maintenance-modal";

  try {
    await db
      .insert(waitlistEmailsTable)
      .values({ email: rawEmail, source })
      .onConflictDoNothing({ target: waitlistEmailsTable.email });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "waitlist insert failed");
    res.status(500).json({ error: "Could not save your email. Please try again." });
  }
});

export default router;
