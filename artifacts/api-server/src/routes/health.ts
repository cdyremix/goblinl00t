import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  // Liveness — process is up. Kept minimal so an external checker can hammer
  // it without causing DB load.
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  // Readiness — the API can actually serve real traffic. Fails if Postgres
  // is unreachable. Cheap query (`select 1`) — no table scans.
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
      db: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
