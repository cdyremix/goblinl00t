// Stripe integration via Replit's connector — credentials are fetched
// from the connector proxy on every call (token rotation safe). NEVER
// cache the Stripe client across requests; tokens expire.
//
// `getStripeSync()` returns the singleton StripeSync instance used by
// stripe-replit-sync to ingest webhooks + run startup `syncBackfill()`.
import Stripe from "stripe";

interface ConnectorSettings {
  publishable: string;
  secret: string;
}

interface ConnectorItem {
  settings: ConnectorSettings;
}

interface ConnectorResponse {
  items?: ConnectorItem[];
}

let connectionSettings: ConnectorItem | undefined;

async function getCredentials(): Promise<{
  publishableKey: string;
  secretKey: string;
}> {
  // Self-host fallback. When the Replit connector env isn't present
  // (e.g. running on a customer VPS via deploy/docker-compose.yml), fall
  // back to plain `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` env
  // vars. The publishable key is also baked into the dashboard at build
  // time via VITE_CLERK_PUBLISHABLE_KEY (separate flow); on the server
  // side we only need it to round-trip through `getStripePublishableKey`
  // for any code path that asks for it.
  const directSecret = process.env["STRIPE_SECRET_KEY"];
  if (directSecret) {
    return {
      publishableKey: process.env["STRIPE_PUBLISHABLE_KEY"] ?? "",
      secretKey: directSecret,
    };
  }

  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!xReplitToken) {
    throw new Error(
      "Stripe credentials not configured: set STRIPE_SECRET_KEY (self-host) or run inside a Replit env with the Stripe connector.",
    );
  }
  if (!hostname) {
    throw new Error("REPLIT_CONNECTORS_HOSTNAME not set");
  }

  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
  });

  const data = (await response.json()) as ConnectorResponse;
  connectionSettings = data.items?.[0];

  if (
    !connectionSettings ||
    !connectionSettings.settings.publishable ||
    !connectionSettings.settings.secret
  ) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    apiVersion: "2026-04-22.dahlia",
  });
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

// StripeSync singleton — owns its own pg pool for webhook + backfill work.
// Module-level singleton: created once per api-server process, reused for
// every webhook delivery. `getStripeSync` is async so we can lazily resolve
// credentials from the connector on first use.
let stripeSync: unknown = null;

export async function getStripeSync(): Promise<{
  processWebhook: (payload: Buffer, signature: string) => Promise<void>;
  findOrCreateManagedWebhook: (
    url: string,
  ) => Promise<{ id: string; url: string }>;
  syncBackfill: (params?: { object?: string }) => Promise<unknown>;
}> {
  if (!stripeSync) {
    const { StripeSync } = await import("stripe-replit-sync");
    const secretKey = await getStripeSecretKey();
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) throw new Error("DATABASE_URL required for StripeSync");

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: databaseUrl,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync as ReturnType<typeof getStripeSync> extends Promise<infer T>
    ? T
    : never;
}
