// Mirror of artifacts/api-server/src/lib/stripeClient.ts — kept in sync so
// admin scripts (seed-products, etc.) can talk to the same Stripe account
// via the same Replit connector credentials. Do NOT diverge.
import Stripe from "stripe";

interface ConnectorItem {
  settings: { publishable: string; secret: string };
}

async function getCredentials(): Promise<{ secretKey: string }> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!xReplitToken) throw new Error("X-Replit-Token not found");
  if (!hostname) throw new Error("REPLIT_CONNECTORS_HOSTNAME not set");

  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  const data = (await response.json()) as { items?: ConnectorItem[] };
  const item = data.items?.[0];
  if (!item || !item.settings.secret) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }
  return { secretKey: item.settings.secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
}
