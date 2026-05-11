import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/bot-service";
import { getStripeSync } from "./lib/stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Initialize Stripe sync. Order matters per stripe-replit-sync's contract:
//   1. runMigrations() — idempotently creates the `stripe.*` schema
//   2. getStripeSync() — singleton, fetches secret from connector
//   3. findOrCreateManagedWebhook() — registers /api/stripe/webhook with Stripe
//   4. syncBackfill() — pulls all existing customers/subscriptions/invoices
//
// Failures are non-fatal so the rest of the API still boots even if the
// Stripe connector is misconfigured (e.g. during local dev without keys).
async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe init");
    return;
  }
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    await runMigrations({ databaseUrl });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.error({ errMessage }, "Stripe migrations failed (continuing)");
    return;
  }

  let sync: Awaited<ReturnType<typeof getStripeSync>>;
  try {
    sync = await getStripeSync();
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.error({ errMessage }, "Stripe sync init failed (continuing)");
    return;
  }

  // Webhook registration + backfill run in their own try-catches so a failure
  // in one doesn't stop the other.
  const replitDomains = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (replitDomains) {
    try {
      const webhookUrl = `https://${replitDomains}/api/stripe/webhook`;
      const webhook = await sync.findOrCreateManagedWebhook(webhookUrl);
      logger.info(
        { webhookId: webhook.id, webhookUrl: webhook.url },
        "stripe webhook ready",
      );
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error({ errMessage }, "Stripe webhook registration failed");
    }
  } else {
    logger.warn("REPLIT_DOMAINS not set — skipping webhook registration");
  }

  try {
    // Pass `object: "all"` — without an explicit object the package falls
    // through its switch and silently no-ops.
    await sync.syncBackfill({ object: "all" });
    logger.info("stripe syncBackfill complete");
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.error({ errMessage }, "Stripe syncBackfill failed");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Goblin L00t server listening");
  // Stripe init in parallel with bot start; both are non-blocking for the
  // HTTP server.
  void initStripe();
  await startBot();
});
