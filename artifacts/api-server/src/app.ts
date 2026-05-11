import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { processStripeWebhook } from "./lib/stripe-webhook-handlers";
import { maintenanceGuard } from "./lib/maintenance-guard";

const app: Express = express();

// Replit fronts every artifact with a reverse proxy, so `req.ip` would
// otherwise resolve to the proxy's loopback address — making per-IP rate
// limits (e.g. dev-bypass-pwned, twitch OAuth init) collapse into a single
// shared bucket. Trust one hop so X-Forwarded-For yields the real client.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// IMPORTANT: Stripe webhook must be registered BEFORE express.json() so the
// raw request body (Buffer) is preserved for signature verification. Order
// per stripe-replit-sync's contract: raw body in, processWebhook validates
// + dispatches.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] ?? "" : signature;
    try {
      await processStripeWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      req.log.error({ errMessage }, "stripe webhook processing failed");
      res.status(400).json({ error: "Webhook processing failed" });
    }
  },
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Maintenance guard runs after clerkMiddleware (so getAuth resolves) and
// before the API router. When MAINTENANCE_MODE is OFF this is a no-op.
// When ON, only the allowlisted endpoints + super-user calls pass through.
app.use("/api", maintenanceGuard);

app.use("/api", router);

export default app;
