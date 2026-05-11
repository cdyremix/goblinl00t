import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";

/**
 * Single source of truth for the maintenance-mode flag, used by both
 * the public `/maintenance/status` endpoint and the API-wide
 * `maintenanceGuard` middleware. Backed by the `app_settings` singleton
 * row (id=1) so admins can flip it from the dashboard without a redeploy.
 *
 * Layered with a tiny in-memory cache (5s TTL) so the guard doesn't
 * hammer Postgres on every request — this middleware runs in front of
 * every `/api/*` call. `setMaintenanceEnabled` busts the cache so a
 * toggle takes effect immediately for the calling process.
 *
 * Env-var override: if `MAINTENANCE_MODE` is truthy in the environment,
 * we treat the wall as ON regardless of the DB row. That preserves the
 * existing "secret-flip" escape hatch (e.g. flip via deployment env if
 * the dashboard is itself broken).
 */

const ROW_ID = 1;
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function envOverride(): boolean {
  const raw = (process.env["MAINTENANCE_MODE"] ?? "").trim().toLowerCase();
  if (!raw) return false;
  return !["0", "false", "off", "no"].includes(raw);
}

async function readFromDb(): Promise<boolean> {
  const [row] = await db
    .select({ maintenanceMode: appSettingsTable.maintenanceMode })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, ROW_ID))
    .limit(1);
  if (row) return row.maintenanceMode;
  // First-ever read — seed the singleton row so subsequent updates can
  // simply UPDATE rather than worry about insert-vs-update branches.
  await db
    .insert(appSettingsTable)
    .values({ id: ROW_ID, maintenanceMode: false })
    .onConflictDoNothing({ target: appSettingsTable.id });
  return false;
}

export async function getMaintenanceEnabled(): Promise<boolean> {
  if (envOverride()) return true;
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  const value = await readFromDb();
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function setMaintenanceEnabled(enabled: boolean): Promise<void> {
  // Upsert keeps this safe even if the seed step above hasn't run yet.
  await db
    .insert(appSettingsTable)
    .values({ id: ROW_ID, maintenanceMode: enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: { maintenanceMode: enabled, updatedAt: new Date() },
    });
  invalidateMaintenanceCache();
}

export function invalidateMaintenanceCache(): void {
  cache = null;
}
