// Seed Stripe products + prices for Goblin L00t. Idempotent: looks up by
// metadata.tier and updates instead of duplicating. Run with:
//
//   pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
//
// In production, products are auto-copied from sandbox by Replit on deploy.
import { getUncachableStripeClient } from "./lib/stripeClient";

interface TierSpec {
  tier: "premium" | "pro";
  name: string;
  description: string;
  unitAmount: number;
}

const TIERS: TierSpec[] = [
  {
    tier: "premium",
    name: "Goblin L00t — Horde Master",
    description:
      "Unlimited giveaways, all bot themes, Trade Office for CS2 skin delivery, Discord webhooks, custom command responses, full Ledger.",
    unitAmount: 499,
  },
  {
    tier: "pro",
    name: "Goblin L00t — Goblin King",
    description:
      "Everything in Horde Master plus unlimited Twitch channels, custom bot name, sponsorship-ready analytics, priority support.",
    unitAmount: 999,
  },
];

async function findProductByTier(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  tier: string,
): Promise<{ id: string } | null> {
  const search = await stripe.products.search({
    query: `metadata['tier']:'${tier}' AND active:'true'`,
  });
  return search.data[0] ?? null;
}

async function findActivePriceForProduct(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  productId: string,
  unitAmount: number,
): Promise<{ id: string } | null> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });
  return (
    prices.data.find(
      (p) =>
        p.unit_amount === unitAmount &&
        p.currency === "usd" &&
        p.recurring?.interval === "month",
    ) ?? null
  );
}

async function seed(): Promise<void> {
  const stripe = await getUncachableStripeClient();

  for (const spec of TIERS) {
    let product = await findProductByTier(stripe, spec.tier);
    if (product) {
      console.log(`✓ Product already exists for tier=${spec.tier}: ${product.id}`);
      await stripe.products.update(product.id, {
        name: spec.name,
        description: spec.description,
        metadata: { tier: spec.tier },
      });
    } else {
      const created = await stripe.products.create({
        name: spec.name,
        description: spec.description,
        metadata: { tier: spec.tier },
      });
      product = created;
      console.log(`+ Created product tier=${spec.tier}: ${product.id}`);
    }

    const existingPrice = await findActivePriceForProduct(
      stripe,
      product.id,
      spec.unitAmount,
    );
    if (existingPrice) {
      console.log(
        `✓ Price already exists for tier=${spec.tier} @ $${(spec.unitAmount / 100).toFixed(2)}/mo: ${existingPrice.id}`,
      );
    } else {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: spec.unitAmount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { tier: spec.tier },
      });
      console.log(
        `+ Created price tier=${spec.tier} @ $${(spec.unitAmount / 100).toFixed(2)}/mo: ${price.id}`,
      );
    }

    // Archive any OTHER active monthly prices on this product so the
    // dashboard /api/stripe/prices endpoint only ever returns one active
    // price per tier. Stripe prices are immutable, so changing the price
    // amount means archiving the old one and creating a new one.
    const allActive = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100,
    });
    for (const p of allActive.data) {
      if (
        p.unit_amount !== spec.unitAmount ||
        p.currency !== "usd" ||
        p.recurring?.interval !== "month"
      ) {
        await stripe.prices.update(p.id, { active: false });
        console.log(
          `- Archived stale price ${p.id} ($${((p.unit_amount ?? 0) / 100).toFixed(2)}/mo)`,
        );
      }
    }
  }

  console.log("\nDone. Webhook will sync these into stripe.* schema shortly.");
}

seed().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("seed-products failed:", msg);
  process.exit(1);
});
