// Stripe billing routes — checkout, portal, subscription, invoices, cancel.
//
// All product/price/customer/subscription/invoice DATA lives in the
// `stripe.*` schema (managed by stripe-replit-sync). NEVER write to those
// tables. The only Stripe-related writes we make are to `users.stripe_*`
// columns (customer + active subscription pointer).
//
// Tiers are mapped via Stripe Product metadata: `metadata.tier in
// {"free","premium","pro"}`. Update the tier by changing metadata in
// Stripe (or re-running scripts/src/seed-products.ts) — do NOT hard-code
// price IDs anywhere.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getAuth } from "@clerk/express";

const router = Router();

/**
 * Trusted canonical app origin for Stripe redirect URLs. We MUST NOT derive
 * this from `Host` / `X-Forwarded-Host` headers — those are caller-controlled
 * and would let a forged request point Stripe's hosted Checkout / Billing
 * Portal back at an attacker origin (open-redirect via Stripe).
 *
 * Source of truth: `REPLIT_DOMAINS` (comma-separated, first entry wins) in
 * production. Falls back to `APP_BASE_URL` then `http://localhost:80` for dev.
 */
function getCanonicalAppBase(): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const first = replitDomains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  return "http://localhost:80";
}

interface PriceRow extends Record<string, unknown> {
  price_id: string;
  unit_amount: number | null;
  currency: string;
  interval: string | null;
  product_id: string;
  product_name: string;
  tier: string | null;
}

async function loadPricesByTier(): Promise<Map<string, PriceRow>> {
  const result = await db.execute<PriceRow>(sql`
    SELECT
      pr.id          AS price_id,
      pr.unit_amount AS unit_amount,
      pr.currency    AS currency,
      pr.recurring->>'interval' AS interval,
      p.id           AS product_id,
      p.name         AS product_name,
      p.metadata->>'tier' AS tier
    FROM stripe.prices pr
    JOIN stripe.products p ON p.id = pr.product
    WHERE pr.active = true
      AND p.active = true
      AND p.metadata->>'tier' IS NOT NULL
  `);
  const map = new Map<string, PriceRow>();
  for (const row of result.rows) {
    if (row.tier) map.set(row.tier, row);
  }
  return map;
}

interface SubRow extends Record<string, unknown> {
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  price_id: string;
  product_id: string;
  product_name: string;
  tier: string | null;
  unit_amount: number | null;
  currency: string;
  interval: string | null;
}

async function loadActiveSubscription(
  customerId: string,
): Promise<SubRow | null> {
  // NOTE: in the stripe-replit-sync schema, ALL timestamp columns
  // (`current_period_end`, `created`, `period_start`, `period_end`, …)
  // are stored as plain `integer` Unix seconds — NOT `timestamp`. Wrapping
  // them in `EXTRACT(EPOCH FROM …)` blows up at runtime ("function pg_catalog.date_part(unknown, integer)
  // does not exist"). Read the column directly. Likewise we don't need to
  // join `subscription_items` — `current_period_end` lives on the
  // subscription row itself, and `s.plan` is the active price id.
  const result = await db.execute<SubRow>(sql`
    SELECT
      s.id,
      s.status,
      s.current_period_end::bigint AS current_period_end,
      s.cancel_at_period_end,
      pr.id   AS price_id,
      p.id    AS product_id,
      p.name  AS product_name,
      p.metadata->>'tier' AS tier,
      pr.unit_amount,
      pr.currency,
      pr.recurring->>'interval' AS interval
    FROM stripe.subscriptions s
    JOIN stripe.prices   pr ON pr.id = s.plan
    JOIN stripe.products p  ON p.id  = pr.product
    WHERE s.customer = ${customerId}
      AND s.status IN ('active','trialing','past_due')
    ORDER BY s.created DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

// GET /stripe/prices — returns the catalog (price + tier metadata) for the
// frontend so it doesn't have to know real Stripe IDs.
router.get("/stripe/prices", async (_req, res) => {
  try {
    const prices = await loadPricesByTier();
    const out: Record<string, {
      priceId: string;
      productId: string;
      unitAmount: number | null;
      currency: string;
      interval: string | null;
      productName: string;
    }> = {};
    for (const [tier, row] of prices) {
      out[tier] = {
        priceId: row.price_id,
        productId: row.product_id,
        unitAmount: row.unit_amount,
        currency: row.currency,
        interval: row.interval,
        productName: row.product_name,
      };
    }
    res.json({ prices: out });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to load prices", detail: errMessage });
  }
});

async function ensureCustomer(
  user: typeof usersTable.$inferSelect,
  email: string | undefined,
): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata: {
      clerkUserId: user.clerkUserId,
      twitchUsername: user.twitchUsername ?? "",
    },
  });
  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, user.id));
  return customer.id;
}

// POST /stripe/checkout — body: { tier: "premium" | "pro" }. Returns
// { url } to redirect the user to Stripe-hosted checkout. After success
// Stripe routes them to /account?tab=rank&checkout=success.
router.post("/stripe/checkout", async (req, res) => {
  // Checkout intentionally allows Clerk-authed users WITHOUT a linked Twitch
  // channel — we want them to be able to subscribe immediately after signup
  // even if they haven't linked their Twitch yet.
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }

  const body = req.body as { tier?: string } | undefined;
  const tier = body?.tier;
  if (tier !== "premium" && tier !== "pro") {
    res.status(400).json({ error: "tier must be 'premium' or 'pro'" });
    return;
  }

  try {
    const prices = await loadPricesByTier();
    const priceRow = prices.get(tier);
    if (!priceRow) {
      res.status(503).json({
        error:
          "Stripe products not yet seeded. Run scripts/src/seed-products.ts.",
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const customerId = await ensureCustomer(user, undefined);

    // Build success/cancel URLs from the trusted REPLIT_DOMAINS env var
    // (NOT request headers — those are attacker-controlled and would let
    // a forged Host header point Stripe redirects at a malicious origin).
    const base = getCanonicalAppBase();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceRow.price_id, quantity: 1 }],
      success_url: `${base}/account?tab=rank&checkout=success`,
      cancel_url: `${base}/account?tab=rank&checkout=cancel`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          clerkUserId: user.clerkUserId,
          tier,
        },
      },
    });

    if (!session.url) {
      res.status(500).json({ error: "Stripe did not return a checkout URL" });
      return;
    }
    res.json({ url: session.url });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe checkout failed");
    res.status(500).json({ error: "Failed to start checkout" });
  }
});

// POST /stripe/portal — opens Stripe-hosted customer portal where the user
// can change payment method, view invoices, cancel/restart subscription.
router.post("/stripe/portal", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  if (!user.stripeCustomerId) {
    res.status(400).json({ error: "No Stripe customer on file. Subscribe first." });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getCanonicalAppBase()}/account?tab=rank`,
    });
    res.json({ url: session.url });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe portal failed");
    res.status(500).json({ error: "Failed to open billing portal" });
  }
});

// GET /stripe/subscription — current active subscription summary, tier
// resolved via product metadata. Reconciles users.subscription_tier as
// a side-effect so the rest of the app sees consistent state even if a
// webhook was dropped.
router.get("/stripe/subscription", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return;
  }
  if (!user.stripeCustomerId) {
    res.json({ subscription: null, tier: user.subscriptionTier });
    return;
  }
  try {
    const sub = await loadActiveSubscription(user.stripeCustomerId);
    if (!sub) {
      // No active sub — downgrade to free.
      if (user.subscriptionTier !== "free" || user.stripeSubscriptionId) {
        await db
          .update(usersTable)
          .set({ subscriptionTier: "free", stripeSubscriptionId: null })
          .where(eq(usersTable.id, user.id));
      }
      res.json({ subscription: null, tier: "free" });
      return;
    }
    const resolvedTier = sub.tier ?? user.subscriptionTier;
    if (
      user.subscriptionTier !== resolvedTier ||
      user.stripeSubscriptionId !== sub.id
    ) {
      await db
        .update(usersTable)
        .set({
          subscriptionTier: resolvedTier,
          stripeSubscriptionId: sub.id,
        })
        .where(eq(usersTable.id, user.id));
    }
    res.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: Number(sub.current_period_end) * 1000,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        priceId: sub.price_id,
        productName: sub.product_name,
        tier: resolvedTier,
        unitAmount: sub.unit_amount,
        currency: sub.currency,
        interval: sub.interval,
      },
      tier: resolvedTier,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe subscription read failed");
    res.status(500).json({ error: "Failed to load subscription" });
  }
});

// POST /stripe/subscription/cancel-at-period-end — body { cancel: boolean }
// Toggle whether the subscription auto-renews. When `cancel: true`, billing
// stops at the end of the current period (still usable until then). When
// `cancel: false` (i.e. resume), auto-renew is turned back on.
router.post("/stripe/subscription/cancel-at-period-end", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as { cancel?: boolean } | undefined;
  if (typeof body?.cancel !== "boolean") {
    res.status(400).json({ error: "body must be { cancel: boolean }" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user?.stripeSubscriptionId) {
    res.status(400).json({ error: "No active subscription" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: body.cancel,
    });
    res.json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe cancel toggle failed");
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

// POST /stripe/subscription/cancel-now — immediately cancel.
router.post("/stripe/subscription/cancel-now", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user?.stripeSubscriptionId) {
    res.status(400).json({ error: "No active subscription" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    await db
      .update(usersTable)
      .set({ subscriptionTier: "free", stripeSubscriptionId: null })
      .where(eq(usersTable.id, user.id));
    res.json({ ok: true });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe cancel-now failed");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
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
  period_start: number;
  period_end: number;
}

// GET /stripe/invoices?status=&from=&to= — billing history with simple
// server-side filters. status: comma-list of stripe invoice statuses.
// from/to: ISO date strings (inclusive day bounds).
router.get("/stripe/invoices", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user?.stripeCustomerId) {
    res.json({ invoices: [] });
    return;
  }
  const statusParam =
    typeof req.query["status"] === "string" ? req.query["status"] : "";
  const allowedStatuses = ["paid", "open", "void", "uncollectible", "draft"];
  const statuses = statusParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowedStatuses.includes(s));
  const fromIso =
    typeof req.query["from"] === "string" ? req.query["from"] : null;
  const toIso = typeof req.query["to"] === "string" ? req.query["to"] : null;
  const fromTs = fromIso ? new Date(fromIso) : null;
  const toTs = toIso ? new Date(toIso) : null;

  try {
    const conditions: ReturnType<typeof sql>[] = [
      sql`customer = ${user.stripeCustomerId}`,
    ];
    if (statuses.length > 0) {
      conditions.push(sql`status = ANY(${statuses})`);
    }
    if (fromTs && !Number.isNaN(fromTs.getTime())) {
      // `created` is integer unix seconds — compare numerically, not against
      // an ISO string (Postgres would error: integer >= text).
      const fromUnix = Math.floor(fromTs.getTime() / 1000);
      conditions.push(sql`created >= ${fromUnix}`);
    }
    if (toTs && !Number.isNaN(toTs.getTime())) {
      // Inclusive day bound — bump 1 day forward.
      const end = new Date(toTs);
      end.setDate(end.getDate() + 1);
      const toUnix = Math.floor(end.getTime() / 1000);
      conditions.push(sql`created < ${toUnix}`);
    }
    const whereClause = conditions.reduce(
      (acc, cond, i) => (i === 0 ? cond : sql`${acc} AND ${cond}`),
    );
    // All timestamp columns on stripe.invoices are integer unix seconds —
    // see SubRow query above for why we don't EXTRACT(EPOCH FROM …).
    const result = await db.execute<InvoiceRow>(sql`
      SELECT
        id,
        number,
        status,
        amount_paid,
        amount_due,
        currency,
        created::bigint AS created,
        hosted_invoice_url,
        invoice_pdf,
        period_start::bigint AS period_start,
        period_end::bigint   AS period_end
      FROM stripe.invoices
      WHERE ${whereClause}
      ORDER BY created DESC
      LIMIT 200
    `);
    res.json({
      invoices: result.rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        amountPaid: row.amount_paid,
        amountDue: row.amount_due,
        currency: row.currency,
        createdAt: Number(row.created) * 1000,
        hostedInvoiceUrl: row.hosted_invoice_url,
        invoicePdf: row.invoice_pdf,
        periodStart: Number(row.period_start) * 1000,
        periodEnd: Number(row.period_end) * 1000,
      })),
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ errMessage }, "stripe invoices read failed");
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

export default router;
