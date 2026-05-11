// Thin wrapper over stripe-replit-sync's webhook processor. Per the
// stripe skill: the handler must be MINIMAL — it only needs to call
// `processWebhook(payload, signature)`. All actual data sync (customers,
// subscriptions, invoices, products, prices) is handled by the package.
// Custom application reactions (writing back to usersTable.subscriptionTier
// etc.) happen lazily on /users/me reads — see routes/users.ts.
import { getStripeSync } from "./stripeClient";
import { logger } from "./logger";

export async function processStripeWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  const sync = await getStripeSync();
  await sync.processWebhook(payload, signature);
  logger.info({ kind: "stripe_webhook" }, "stripe webhook processed");
}
