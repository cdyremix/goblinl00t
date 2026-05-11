import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

/**
 * Mirrors `routes/maintenance.ts#isMaintenanceModeEnabled` — kept in
 * lockstep so the env flag has one truthiness rule across the codebase.
 */
function isMaintenanceModeEnabled(): boolean {
  const raw = (process.env["MAINTENANCE_MODE"] ?? "").trim().toLowerCase();
  if (!raw) return false;
  return !["0", "false", "off", "no"].includes(raw);
}

/**
 * Endpoints that stay reachable even while maintenance mode is on.
 * - `maintenance/*` so the wall itself can fetch its status.
 * - `waitlist` so the launch-notify form keeps capturing emails.
 * - `healthz`/`readyz` so uptime monitors don't false-positive.
 * - `auth/*` so an admin can complete OAuth round-trips to bypass.
 * - `users/me` so the dashboard can resolve the caller's admin flag
 *   immediately after sign-in (the gate decision needs this row).
 *
 * Stripe webhook is pre-mounted in app.ts BEFORE this guard so it isn't
 * affected. Stripe checkout/portal endpoints are intentionally NOT
 * allowlisted — no public sign-ups during a maintenance window.
 */
const PATH_ALLOWLIST = new Set<string>([
  "/maintenance/status",
  "/waitlist",
  "/healthz",
  "/readyz",
  "/users/me",
]);
const PREFIX_ALLOWLIST = ["/auth/"];

function pathPasses(urlPath: string): boolean {
  if (PATH_ALLOWLIST.has(urlPath)) return true;
  return PREFIX_ALLOWLIST.some((p) => urlPath.startsWith(p));
}

/**
 * Server-side companion to the frontend `<MaintenanceGate>`. While
 * `MAINTENANCE_MODE` is on, returns 503 for every `/api/*` request
 * EXCEPT the allowlist above and authenticated requests from a
 * super-user (resolved server-side from `usersTable.isAdmin`).
 *
 * Defense-in-depth: the frontend wall blocks the UI; this middleware
 * blocks direct API calls so a non-admin can't poke routes via curl
 * or devtools while we're still tweaking.
 *
 * Mount AFTER `clerkMiddleware` so `getAuth(req)` resolves the session.
 */
export async function maintenanceGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isMaintenanceModeEnabled()) {
    next();
    return;
  }

  // The router is mounted at `/api`, so `req.path` here is the path
  // RELATIVE to that prefix (e.g. `/maintenance/status`, not
  // `/api/maintenance/status`). Allowlist entries match that shape.
  if (pathPasses(req.path)) {
    next();
    return;
  }

  try {
    const { userId } = getAuth(req);
    if (userId) {
      const [row] = await db
        .select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, userId))
        .limit(1);
      if (row?.isAdmin) {
        next();
        return;
      }
    }
  } catch (err) {
    req.log.warn({ errMessage: err instanceof Error ? err.message : String(err) }, "maintenance guard auth lookup failed");
    // Fall through to 503 — fail closed.
  }

  res.status(503).json({
    error: "Goblin L00t is in maintenance. Try again soon.",
    maintenance: true,
  });
}
