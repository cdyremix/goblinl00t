import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { clerkClient } from "@clerk/express";
import { requireAdmin } from "../lib/auth-helpers";
import { getUncachableStripeClient } from "../lib/stripeClient";

const router = Router();

/**
 * GET /admin/me — quick "am I an admin?" probe used by the dashboard
 * to decide whether to show the Admin sidebar link. Returns 200 with
 * `{ isAdmin: true }` when the caller is an admin, 403 otherwise.
 */
router.get("/admin/me", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  res.json({ isAdmin: true, user: ctx.user });
});

const CreateUserBody = z
  .object({
    // Email/password use loose schemas here so the body parses regardless
    // of `bypassValidation`; the strict checks are applied conditionally
    // below. Hard caps stay (defense-in-depth: avoid logging / storing
    // pathological inputs) but format/min-length only apply when bypass
    // is off. The route is admin-only either way.
    email: z.string().min(1).max(254),
    password: z.string().min(1).max(128),
    // Optional pre-link username. Lowercased + format-checked when
    // `bypassValidation` is off (must look like a real Twitch handle so
    // the bot's channel-join layer doesn't choke on it). When the user
    // later completes Twitch OAuth, the callback overwrites this with
    // the real `twitchUser.login` value, so admin-set usernames are
    // effectively a placeholder until the OAuth round-trip lands.
    twitchUsername: z.string().trim().min(1).max(64).optional().nullable(),
    isAdmin: z.boolean().optional(),
    isDev: z.boolean().optional(),
    subscriptionTier: z.enum(["free", "premium", "pro"]).optional(),
  })
  // Mutually exclusive — admin already implies feature bypass; the dev
  // flag is for accounts that should NOT have admin powers, so allowing
  // both at once would be a UX trap (the admin Switch silently wins).
  .refine((d) => !(d.isAdmin && d.isDev), {
    message: "isAdmin and isDev are mutually exclusive",
    path: ["isDev"],
  });

// Same RFC5322-ish pattern Zod uses internally; pulled out so the
// "bypass off" branch can run it explicitly.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /admin/users — create a fresh streamer account. Provisions the
 * Clerk user (email pre-verified, password set) AND the matching
 * `usersTable` row in one round-trip so the new account can sign in
 * immediately with the supplied creds.
 *
 * Compensating cleanup: if the DB insert fails AFTER Clerk createUser
 * succeeds, we delete the Clerk user so we don't leak an orphaned
 * Clerk account that has no matching DB row (which would later
 * auto-create on first sign-in but with `isAdmin=false` and the wrong
 * tier — surprising to the operator who thought the create failed).
 *
 * `twitchUsername` is normalized to lowercase to match the convention
 * used everywhere else (`bot/bot-service.ts#loadJoinableChannels`,
 * chat-message inserts, etc.). It does NOT trigger a `joinChannel`
 * call — admin-created accounts still need the streamer to complete
 * the Twitch OAuth flow to bind `twitchUserId` and the bot to actually
 * authenticate as them.
 */
router.post("/admin/users", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const { email, password, twitchUsername, isAdmin, isDev, subscriptionTier } = parsed.data;
  // Normalize lowercase up front so uniqueness check + insert + bot
  // channel join all key on the same string.
  const normalizedTwitch = twitchUsername ? twitchUsername.toLowerCase() : null;

  // Super-admin accounts auto-bypass validation. Rationale: ops/QA
  // routinely seed admin accounts with weak well-known credentials
  // (e.g. local dev), and there's no UX win in forcing format checks
  // on a row the operator already has full system access to. For every
  // other role (Streamer / Dev) we enforce the same checks the public
  // sign-up flow does — those accounts represent real end users.
  const bypassValidation = isAdmin === true;
  // Admin AND dev accounts skip the Clerk email-verification round-trip.
  // Both roles are operator-provisioned (internal staff / QA), so a
  // verification code email isn't useful — the admin already owns the
  // mailbox or is just seeding a throwaway login. Streamer rows still
  // get the standard verification flow.
  const skipEmailVerification = isAdmin === true || isDev === true;

  if (!bypassValidation) {
    const issues: Array<{ path: (string | number)[]; message: string }> = [];
    if (!EMAIL_RE.test(email)) {
      issues.push({ path: ["email"], message: "Enter a valid email address." });
    }
    if (password.length < 8) {
      issues.push({ path: ["password"], message: "Password must be at least 8 characters." });
    }
    // Twitch handle format: alphanumeric + underscore, 4–25 chars per
    // Twitch's public docs. Only enforced when bypass is off — admins
    // sometimes need to seed odd legacy / test handles.
    if (normalizedTwitch && !/^[a-z0-9_]{4,25}$/.test(normalizedTwitch)) {
      issues.push({
        path: ["twitchUsername"],
        message: "Twitch handles are 4–25 characters, letters/numbers/underscore only.",
      });
    }
    if (issues.length > 0) {
      res.status(400).json({ error: "Invalid body", issues });
      return;
    }
  }

  // Uniqueness pre-flight — twitch_username has a UNIQUE index, so we'd
  // get a 23505 either way, but returning a clean 409 with a per-field
  // issue lets the dialog render it inline instead of as a generic 500.
  if (normalizedTwitch) {
    const [conflict] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.twitchUsername, normalizedTwitch))
      .limit(1);
    if (conflict) {
      res.status(409).json({
        error: `Twitch handle "${normalizedTwitch}" is already taken.`,
        issues: [{ path: ["twitchUsername"], message: "Already taken by another account." }],
      });
      return;
    }
  }

  // Step 1: Clerk create (isolated try). Map Clerk's structured errors
  // (`{ errors: [{ code, message }] }`) into appropriate HTTP statuses
  // so the admin sees "email taken" / "password too weak" instead of a
  // generic 500.
  let clerkUserId: string;
  try {
    const created = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      skipPasswordChecks: bypassValidation,
    });
    clerkUserId = created.id;
    // For admin/dev rows: explicitly flip every email address to
    // verified=true so Clerk doesn't gate first sign-in on a code we
    // never want to send. `createUser` leaves new addresses unverified
    // by default, so we sweep them post-create. Best-effort — a single
    // failed verify shouldn't block the whole create (the row exists
    // and can still sign in once the user clicks the verify link).
    if (skipEmailVerification) {
      for (const addr of created.emailAddresses) {
        try {
          await clerkClient.emailAddresses.updateEmailAddress(addr.id, { verified: true });
        } catch (verifyErr) {
          const verifyMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
          req.log.warn(
            { verifyMsg, clerkUserId, emailId: addr.id, adminId: ctx.user.id },
            "admin: failed to auto-verify email on admin/dev create",
          );
        }
      }
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    // Clerk SDK errors surface a `.errors[]` array with stable codes.
    const codes: string[] = ((err as { errors?: Array<{ code?: string }> })?.errors ?? [])
      .map((e) => e.code ?? "")
      .filter(Boolean);
    const isDuplicate = codes.some((c) => c.includes("identifier_exists") || c.includes("already_exists"));
    const isWeakPwd = codes.some((c) => c.includes("password"));
    const status = isDuplicate ? 409 : isWeakPwd ? 422 : 500;
    req.log.warn({ errMessage, codes, adminId: ctx.user.id }, "admin: clerk create rejected");
    res.status(status).json({
      error: isDuplicate
        ? "An account with that email already exists."
        : isWeakPwd
          ? "Password rejected by Clerk: " + errMessage
          : "Failed to create Clerk user",
      detail: errMessage,
    });
    return;
  }

  // Step 2: DB insert (isolated try). On failure, roll back the Clerk
  // user we just created so we don't leak an orphan. Note: a successful
  // res.json() throw (extremely rare — happens with closed sockets)
  // would NOT trigger rollback because it's outside this block. That's
  // intentional — by the time we're writing the response, the row is
  // committed and we shouldn't undo it.
  let row: typeof usersTable.$inferSelect;
  try {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        clerkUserId,
        // Optional admin-supplied placeholder. Will be overwritten with
        // the canonical Twitch login when the user completes OAuth.
        // Null → user shows as "Unknown Goblin" in the UI until then.
        twitchUsername: normalizedTwitch,
        isAdmin: isAdmin ?? false,
        isDev: isDev ?? false,
        subscriptionTier: subscriptionTier ?? "free",
        // Skip the post-signup tier picker for admin-created accounts —
        // the operator already chose the tier in the dialog.
        tierSelected: true,
      })
      .returning();
    row = inserted!;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, clerkUserId, adminId: ctx.user.id }, "admin: db insert failed, rolling back Clerk user");
    try {
      await clerkClient.users.deleteUser(clerkUserId);
    } catch (cleanupErr) {
      const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      req.log.error(
        { cleanupMsg, clerkUserId },
        "admin: failed to roll back orphaned Clerk user — manual cleanup required",
      );
    }
    // Postgres unique-violation code is `23505` — surfaces as a race-loss
    // on the `twitch_username` unique constraint when the pre-flight
    // check passed but a concurrent create won the insert. Map to 409.
    const isUniqueViolation = (err as { code?: string })?.code === "23505";
    res.status(isUniqueViolation ? 409 : 500).json({
      error: isUniqueViolation
        ? "Twitch handle is already taken."
        : "Failed to create user",
      detail: errMessage,
    });
    return;
  }

  res.status(201).json({ user: row });
});

/**
 * GET /admin/users — full streamer roster. Includes every column the
 * admin dashboard might want to display. Sorted newest-first so freshly
 * signed-up accounts surface at the top of the table.
 */
router.get("/admin/users", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      twitchUsername: usersTable.twitchUsername,
      twitchUserId: usersTable.twitchUserId,
      steamUsername: usersTable.steamUsername,
      steamId64: usersTable.steamId64,
      subscriptionTier: usersTable.subscriptionTier,
      tierSelected: usersTable.tierSelected,
      isAdmin: usersTable.isAdmin,
      isDev: usersTable.isDev,
      botTheme: usersTable.botTheme,
      botName: usersTable.botName,
      goblinEventsEnabled: usersTable.goblinEventsEnabled,
      lootDropsEnabled: usersTable.lootDropsEnabled,
      coinRedemptionEnabled: usersTable.coinRedemptionEnabled,
      coinCap: usersTable.coinCap,
      stripeCustomerId: usersTable.stripeCustomerId,
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  // Best-effort enrich every row with `emailVerified` from Clerk. Done
  // as a single batched `getUserList({ userId: [...] })` call so the
  // roster pays one Clerk round-trip instead of N. Any failure leaves
  // the field as `null` and the table renders an "unknown" badge —
  // we don't want a flaky Clerk to take down the entire admin console.
  const verifiedById = new Map<string, boolean>();
  if (rows.length > 0) {
    try {
      // Clerk's getUserList caps `userId[]` at 100 per call; chunk so a
      // big roster doesn't silently drop the tail.
      const ids = rows.map((r) => r.clerkUserId);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const list = await clerkClient.users.getUserList({ userId: chunk, limit: chunk.length });
        for (const cu of list.data) {
          const primary =
            cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ??
            cu.emailAddresses[0];
          // Clerk's verification status lives on `emailAddress.verification.status`
          // — "verified" is the only success value; "unverified", "expired",
          // "failed", and `null` all map to false.
          verifiedById.set(cu.id, primary?.verification?.status === "verified");
        }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      req.log.warn({ errMessage }, "admin: bulk clerk lookup failed — emailVerified will be null");
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    emailVerified: verifiedById.has(r.clerkUserId) ? verifiedById.get(r.clerkUserId)! : null,
  }));

  res.json({ users: enriched });
});

/**
 * GET /admin/users/:id — single-user enriched view: DB row + Clerk
 * profile (email, name, last sign-in) + active Stripe subscription.
 * Used by the admin Edit dialog to populate fields.
 */
router.get("/admin/users/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Best-effort Clerk fetch — Clerk's API can be flaky and we don't want
  // a missing Clerk profile to block the rest of the dialog from loading.
  let clerk: {
    email: string | null;
    emailVerified: boolean | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: number | null;
    lastSignInAt: number | null;
  } | null = null;
  try {
    const cu = await clerkClient.users.getUser(user.clerkUserId);
    const primaryAddr =
      cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ??
      cu.emailAddresses[0];
    clerk = {
      email: primaryAddr?.emailAddress ?? null,
      // null when Clerk lookup succeeded but the user has no email
      // record at all (extremely rare — Clerk requires at least one
      // identifier). Otherwise true/false from the verification status.
      emailVerified: primaryAddr ? primaryAddr.verification?.status === "verified" : null,
      firstName: cu.firstName ?? null,
      lastName: cu.lastName ?? null,
      createdAt: cu.createdAt ?? null,
      lastSignInAt: cu.lastSignInAt ?? null,
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.warn({ errMessage, clerkUserId: user.clerkUserId }, "admin: clerk lookup failed");
  }

  // Active Stripe sub — same shape as /api/stripe/subscription returns
  // for the user themselves, surfaced here so the admin sees real
  // subscription state (not just the locally-cached tier).
  let subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    productName: string;
    tier: string | null;
    unitAmount: number | null;
    currency: string;
    interval: string | null;
  } | null = null;
  if (user.stripeCustomerId) {
    try {
      const result = await db.execute<{
        id: string;
        status: string;
        current_period_end: number;
        cancel_at_period_end: boolean;
        product_name: string;
        tier: string | null;
        unit_amount: number | null;
        currency: string;
        interval: string | null;
      }>(sql`
        SELECT
          s.id,
          s.status,
          s.current_period_end::bigint AS current_period_end,
          s.cancel_at_period_end,
          p.name  AS product_name,
          p.metadata->>'tier' AS tier,
          pr.unit_amount,
          pr.currency,
          pr.recurring->>'interval' AS interval
        FROM stripe.subscriptions s
        JOIN stripe.prices   pr ON pr.id = s.plan
        JOIN stripe.products p  ON p.id  = pr.product
        WHERE s.customer = ${user.stripeCustomerId}
          AND s.status IN ('active','trialing','past_due')
        ORDER BY s.created DESC
        LIMIT 1
      `);
      const row = result.rows[0];
      if (row) {
        subscription = {
          id: row.id,
          status: row.status,
          currentPeriodEnd: Number(row.current_period_end) * 1000,
          cancelAtPeriodEnd: row.cancel_at_period_end,
          productName: row.product_name,
          tier: row.tier,
          unitAmount: row.unit_amount,
          currency: row.currency,
          interval: row.interval,
        };
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      req.log.warn({ errMessage }, "admin: subscription lookup failed");
    }
  }

  res.json({ user, clerk, subscription });
});

const PatchUserBody = z.object({
  // Identity overrides — admins occasionally need to fix a Twitch handle
  // (re-name, ban, manual override). These do NOT re-trigger any OAuth
  // flow — they're purely a local DB rename. The bot will join the new
  // channel on next restart / settings invalidation.
  twitchUsername: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, "Twitch usernames are alphanumeric + underscore")
    .nullable()
    .optional(),
  steamUsername: z.string().min(1).max(120).nullable().optional(),
  // Subscription / role.
  subscriptionTier: z.enum(["free", "premium", "pro"]).optional(),
  isAdmin: z.boolean().optional(),
  isDev: z.boolean().optional(),
  tierSelected: z.boolean().optional(),
  // Bot config.
  botTheme: z.enum(["goblin", "cs2"]).optional(),
  botName: z.string().min(1).max(60).optional(),
  goblinEventsEnabled: z.boolean().optional(),
  lootDropsEnabled: z.boolean().optional(),
  coinRedemptionEnabled: z.boolean().optional(),
  coinCap: z.number().int().nonnegative().nullable().optional(),
});

/**
 * PATCH /admin/users/:id — admin-only override of any per-user field.
 * Only fields explicitly listed in `PatchUserBody` are writable; the
 * Stripe IDs / Twitch tokens are never reachable from this endpoint
 * because flipping them on a live account would corrupt the Stripe
 * sync + bot-channel mapping.
 *
 * Note: when the admin promotes a user to a paid tier from this
 * endpoint, no Stripe charge is created — this is a manual entitlement
 * override (e.g. comp accounts for a partnered streamer). The next
 * `/api/stripe/subscription` reconcile WILL still overwrite the tier
 * based on the user's actual active Stripe subscription, so manual
 * promotions are sticky only if the user has no Stripe sub.
 */
router.patch("/admin/users/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const parsed = PatchUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  // Block self-demotion of admin so the project owner can't accidentally
  // strip their own super-user rights and lock themselves out.
  if (parsed.data.isAdmin === false && id === ctx.user.id) {
    res.status(400).json({ error: "Refusing to demote yourself." });
    return;
  }

  // Normalize twitchUsername to lowercase so it matches `channel`
  // strings used everywhere else (chat events normalize via tags.username
  // .toLowerCase()). Otherwise the bot's settings cache would key on a
  // mixed-case channel and silently miss updates.
  const updates: Partial<typeof usersTable.$inferInsert> = { ...parsed.data };
  if (typeof updates.twitchUsername === "string") {
    updates.twitchUsername = updates.twitchUsername.toLowerCase();
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  // Snapshot the previous row BEFORE the update for two reasons:
  //   1) `twitchUsername` change → part old / join new bot channel.
  //   2) `isAdmin`/`isDev` mutex enforcement (these flags are mutually
  //      exclusive by design — admin already implies feature bypass; a
  //      dev account exists precisely to grant feature bypass WITHOUT
  //      admin powers). Partial PATCHes can otherwise sneak both true
  //      (e.g. user is already isDev=true, admin sets isAdmin=true and
  //      omits isDev). Compute the EFFECTIVE post-update flags and
  //      reject if both would land true.
  const [before] = await db
    .select({
      twitchUsername: usersTable.twitchUsername,
      isAdmin: usersTable.isAdmin,
      isDev: usersTable.isDev,
    })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const nextIsAdmin = updates.isAdmin ?? before.isAdmin;
  const nextIsDev = updates.isDev ?? before.isDev;
  if (nextIsAdmin && nextIsDev) {
    res.status(400).json({
      error:
        "isAdmin and isDev are mutually exclusive. Clear one before setting the other.",
    });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Reconcile bot membership + per-channel caches whenever the linked
  // twitchUsername key actually changed. Covers all three transitions
  // an admin can perform:
  //   - rename:  before "alice"  → updates "bob"   (part old, join new)
  //   - link:    before null     → updates "alice" (join new)
  //   - unlink:  before "alice"  → updates null    (part old)
  // Note: `"twitchUsername" in updates` is true even when the value is
  // null (Zod parse keeps the key), so we check explicitly.
  const twitchKeyChanged =
    "twitchUsername" in updates && before?.twitchUsername !== updates.twitchUsername;
  if (twitchKeyChanged) {
    const oldCh = before?.twitchUsername ?? null;
    const newCh = (updates.twitchUsername as string | null | undefined) ?? null;
    try {
      const { partChannel, joinChannel, reloadCustomCommands } = await import("../bot/bot-service");
      const { invalidateChannelTheme } = await import("../bot/channel-theme");
      const { invalidateChannelSettings } = await import("../bot/channel-settings");
      if (oldCh) {
        await partChannel(oldCh);
        invalidateChannelTheme(oldCh);
        invalidateChannelSettings(oldCh);
      }
      if (newCh) {
        await joinChannel(newCh);
        invalidateChannelTheme(newCh);
        invalidateChannelSettings(newCh);
      }
      // Custom-command cache is keyed on twitchUsername, so a rename
      // (or link/unlink) requires a reload or the user's customs would
      // either fire on the wrong channel or stop firing entirely.
      await reloadCustomCommands();
    } catch (err) {
      req.log.warn({ err, userId: id }, "admin: bot join/part after twitchUsername change failed");
    }
  }

  res.json({ user: updated });
});

const EmailBody = z.object({
  email: z.string().email().max(254),
});

/**
 * POST /admin/users/:id/email/verify — force-mark every email address
 * on a Clerk user as verified. Use case: legacy dev/admin accounts
 * created before auto-verify-on-create existed, or any account whose
 * mailbox is fake (e.g. `test@test.com`) and can't actually receive a
 * Clerk verification code. Idempotent — re-verifying a verified
 * address is a no-op on Clerk's side.
 *
 * Locked behind `requireAdmin` since manually flipping verification
 * on a real user's account would let an admin hijack a sign-in flow.
 */
router.post("/admin/users/:id/email/verify", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    const cu = await clerkClient.users.getUser(user.clerkUserId);
    let verifiedCount = 0;
    let failedCount = 0;
    for (const addr of cu.emailAddresses) {
      // Skip already-verified addresses to avoid noise in the count;
      // Clerk would no-op anyway but we want an honest "verified N" total.
      if (addr.verification?.status === "verified") {
        verifiedCount += 1;
        continue;
      }
      try {
        await clerkClient.emailAddresses.updateEmailAddress(addr.id, { verified: true });
        verifiedCount += 1;
      } catch (verifyErr) {
        failedCount += 1;
        const verifyMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        req.log.warn(
          { verifyMsg, clerkUserId: user.clerkUserId, emailId: addr.id, adminId: ctx.user.id },
          "admin: manual email verify failed for one address",
        );
      }
    }
    if (verifiedCount === 0 && failedCount > 0) {
      res.status(500).json({ error: "Failed to verify any email address" });
      return;
    }
    res.json({ ok: true, verified: verifiedCount, failed: failedCount });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id, adminId: ctx.user.id }, "admin: email verify failed");
    res.status(500).json({ error: "Failed to verify email", detail: errMessage });
  }
});

/**
 * POST /admin/users/:id/email — admin-set primary email via Clerk.
 * Clerk requires us to (1) create a new email-address record on the
 * user, (2) flip it to `primary: true`, then (3) optionally remove the
 * old emails. We mark the new address verified so the user isn't gated
 * by email confirmation on next sign-in.
 *
 * If the new address already exists on this Clerk user we just promote
 * it to primary — Clerk rejects duplicate creates with a 422.
 */
router.post("/admin/users/:id/email", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = EmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    const cu = await clerkClient.users.getUser(user.clerkUserId);
    const target = parsed.data.email.toLowerCase();
    let emailId = cu.emailAddresses.find(
      (e) => e.emailAddress.toLowerCase() === target,
    )?.id;
    if (!emailId) {
      const created = await clerkClient.emailAddresses.createEmailAddress({
        userId: user.clerkUserId,
        emailAddress: target,
        verified: true,
        primary: true,
      });
      emailId = created.id;
    } else {
      await clerkClient.users.updateUser(user.clerkUserId, {
        primaryEmailAddressID: emailId,
      });
    }
    // Best-effort: sweep up old non-primary addresses so the account
    // doesn't accumulate stale emails.
    for (const e of cu.emailAddresses) {
      if (e.id !== emailId) {
        try {
          await clerkClient.emailAddresses.deleteEmailAddress(e.id);
        } catch {
          /* non-fatal — deletion can fail if the address backs an SSO link */
        }
      }
    }
    res.json({ ok: true, email: target });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id }, "admin: email change failed");
    res.status(500).json({ error: "Failed to update email", detail: errMessage });
  }
});

const PasswordBody = z.object({
  password: z.string().min(8).max(128),
});

/**
 * POST /admin/users/:id/password — admin-set a temporary password.
 * Forwarded straight to Clerk via `users.updateUser({ password })`.
 * Clerk enforces its own complexity rules; we just gate length here.
 *
 * Setting `signOutOfOtherSessions: true` invalidates every existing
 * session so the user is forced to re-auth with the new password —
 * critical for "I locked someone out, here's their fresh creds" flows.
 */
router.post("/admin/users/:id/password", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = PasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  try {
    await clerkClient.users.updateUser(user.clerkUserId, {
      password: parsed.data.password,
      signOutOfOtherSessions: true,
    });
    res.json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id }, "admin: password reset failed");
    res.status(500).json({ error: "Failed to set password", detail: errMessage });
  }
});

/**
 * DELETE /admin/users/:id — full account wipe. Cascade order matters:
 *   1) Cancel any active Stripe subscription so no further charges land.
 *   2) Delete the Clerk record so the user can no longer sign in.
 *   3) Delete the DB row. FK cascades wipe `custom_commands` and
 *      `giveaway_presets`. Chat-history rows (loot_drops,
 *      point_redemptions, user_inventory, command_logs) are channel-
 *      scoped strings — they're left in place by design so the
 *      historical Ledger view remains intact for other admins.
 *
 * Refuses to delete the caller themselves so an admin can't lock
 * themselves out with one slip.
 */
router.delete("/admin/users/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (id === ctx.user.id) {
    res.status(400).json({ error: "Refusing to delete yourself." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // 1) Stripe sub — cancel-now so the customer isn't billed again.
  if (user.stripeSubscriptionId) {
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      req.log.warn({ errMessage, userId: id }, "admin: stripe cancel during delete failed");
      // Non-fatal — keep going so the row gets removed regardless. Admin
      // can clean up the Stripe sub manually if needed.
    }
  }
  // 2) Clerk delete.
  try {
    await clerkClient.users.deleteUser(user.clerkUserId);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.warn({ errMessage, userId: id }, "admin: clerk delete failed");
    // Non-fatal too — the user might already be gone in Clerk.
  }
  // 3) DB delete. FK cascades handle dependent rows.
  await db.delete(usersTable).where(eq(usersTable.id, id));

  // 4) Drop the bot from the deleted streamer's chat so it stops
  //    listening on a channel with no associated account. Best-effort:
  //    a failure here doesn't undo the cascade above.
  if (user.twitchUsername) {
    try {
      const { partChannel, reloadCustomCommands } = await import("../bot/bot-service");
      await partChannel(user.twitchUsername);
      await reloadCustomCommands();
    } catch (err) {
      req.log.warn({ err, userId: id }, "admin: bot part after delete failed");
    }
  }

  res.json({ ok: true });
});

interface InvoiceRow extends Record<string, unknown> {
  id: string;
  number: string | null;
  status: string;
  amount_paid: number;
  amount_due: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  charge: string | null;
  amount_refunded: number | null;
}

/**
 * GET /admin/users/:id/invoices — billing history for a single user.
 * Joins to `stripe.charges` so we can surface the refundable amount
 * (charge.amount - charge.amount_refunded) per invoice without a
 * second round-trip from the dashboard.
 */
router.get("/admin/users/:id/invoices", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.stripeCustomerId) {
    res.json({ invoices: [] });
    return;
  }
  try {
    const result = await db.execute<InvoiceRow>(sql`
      SELECT
        i.id,
        i.number,
        i.status,
        i.amount_paid,
        i.amount_due,
        i.currency,
        i.created::bigint AS created,
        i.hosted_invoice_url,
        i.invoice_pdf,
        i.charge,
        c.amount_refunded
      FROM stripe.invoices i
      LEFT JOIN stripe.charges c ON c.id = i.charge
      WHERE i.customer = ${user.stripeCustomerId}
      ORDER BY i.created DESC
      LIMIT 200
    `);
    res.json({
      invoices: result.rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        amountPaid: row.amount_paid,
        amountDue: row.amount_due,
        amountRefunded: row.amount_refunded ?? 0,
        currency: row.currency,
        createdAt: Number(row.created) * 1000,
        hostedInvoiceUrl: row.hosted_invoice_url,
        invoicePdf: row.invoice_pdf,
        chargeId: row.charge,
        refundable:
          row.charge != null &&
          row.amount_paid > 0 &&
          row.amount_paid > (row.amount_refunded ?? 0),
      })),
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id }, "admin: invoices read failed");
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

const RefundBody = z.object({
  chargeId: z.string().startsWith("ch_").or(z.string().startsWith("py_")),
  // Optional partial-refund amount in cents. Omit for full refund.
  amount: z.number().int().positive().optional(),
  reason: z
    .enum(["duplicate", "fraudulent", "requested_by_customer"])
    .optional(),
});

/**
 * POST /admin/users/:id/refund — issue a Stripe refund against one of
 * the user's charges. The chargeId is supplied by the dashboard from
 * the invoices list; we don't trust an arbitrary charge id, so we
 * verify it belongs to this user's Stripe customer before refunding.
 */
router.post("/admin/users/:id/refund", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = RefundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user?.stripeCustomerId) {
    res.status(404).json({ error: "User has no Stripe customer" });
    return;
  }

  // Defence-in-depth: confirm the charge actually belongs to this user
  // BEFORE we spend a Stripe API call. The dashboard already only
  // surfaces this user's charges, but a forged request to /admin/users/
  // /<other>/refund with a known chargeId from a different customer
  // would otherwise refund the wrong account.
  const owns = await db.execute<{ id: string }>(sql`
    SELECT id FROM stripe.charges
    WHERE id = ${parsed.data.chargeId}
      AND customer = ${user.stripeCustomerId}
    LIMIT 1
  `);
  if (owns.rows.length === 0) {
    res.status(404).json({ error: "Charge not found for this user" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const refund = await stripe.refunds.create({
      charge: parsed.data.chargeId,
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      metadata: {
        adminClerkUserId: ctx.user.clerkUserId,
        targetUserId: String(id),
      },
    });
    res.json({
      ok: true,
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
        currency: refund.currency,
      },
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id }, "admin: refund failed");
    res.status(500).json({ error: "Failed to issue refund", detail: errMessage });
  }
});

/**
 * POST /admin/users/:id/subscription/cancel — admin-initiated immediate
 * cancellation of the target user's active Stripe subscription. Same
 * shape as the user-facing /stripe/subscription/cancel-now but operates
 * on any user the admin selects.
 */
router.post("/admin/users/:id/subscription/cancel", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user?.stripeSubscriptionId) {
    res.status(400).json({ error: "User has no active Stripe subscription" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    await db
      .update(usersTable)
      .set({ subscriptionTier: "free", stripeSubscriptionId: null })
      .where(eq(usersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage, userId: id }, "admin: cancel sub failed");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

/**
 * GET /admin/stats — system-wide summary card for the admin dashboard.
 * Aggregates total users, paid users by tier, twitch-linked count, etc.
 */
router.get("/admin/stats", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      free: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'free')::int`,
      premium: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'premium')::int`,
      pro: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'pro')::int`,
      twitchLinked: sql<number>`count(*) filter (where ${usersTable.twitchUsername} is not null)::int`,
      steamLinked: sql<number>`count(*) filter (where ${usersTable.steamId64} is not null)::int`,
      admins: sql<number>`count(*) filter (where ${usersTable.isAdmin} = true)::int`,
    })
    .from(usersTable);

  res.json({ stats: counts ?? null });
});

/**
 * GET /admin/maintenance — current state of the launch wall.
 * `envOverride: true` means the deployment env is forcing it ON
 * regardless of the DB toggle (so the UI can disable the switch +
 * explain why it can't be turned off from the dashboard).
 */
router.get("/admin/maintenance", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { getMaintenanceEnabled } = await import("../lib/maintenance-state");
  const envRaw = (process.env["MAINTENANCE_MODE"] ?? "").trim().toLowerCase();
  const envOverride = envRaw !== "" && !["0", "false", "off", "no"].includes(envRaw);
  const enabled = await getMaintenanceEnabled();
  res.json({ enabled, envOverride });
});

/**
 * PUT /admin/maintenance — flip the launch wall. Body `{ enabled: bool }`.
 * Writes to the `app_settings` singleton and busts the in-process cache
 * so the next request sees the new value immediately.
 */
router.put("/admin/maintenance", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const body = req.body as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "Body must include { enabled: boolean }." });
    return;
  }
  const { setMaintenanceEnabled, getMaintenanceEnabled } = await import(
    "../lib/maintenance-state"
  );
  await setMaintenanceEnabled(body.enabled);
  const envRaw = (process.env["MAINTENANCE_MODE"] ?? "").trim().toLowerCase();
  const envOverride = envRaw !== "" && !["0", "false", "off", "no"].includes(envRaw);
  const effective = await getMaintenanceEnabled();
  req.log.info(
    { adminId: ctx.user.id, requested: body.enabled, effective },
    "maintenance mode toggled",
  );
  res.json({ enabled: effective, envOverride });
});

export default router;
