import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Per-channel on/off overrides for built-in commands.
 *
 * Cached in-memory, keyed by lowercase channel name (== streamer's
 * `usersTable.twitchUsername`). Refresh with `invalidateCommandToggles`
 * after a successful toggle in routes/commands.ts so chat sees changes
 * without a server restart.
 *
 * The bot calls `getToggleFor(channel, canonical, fallback)` from the
 * chat handler; if the channel hasn't overridden the command, the
 * built-in default (`fallback`) is used — which is currently `true` for
 * every shipped command, so absent overrides keep behaviour identical
 * to the legacy global-enabled flag.
 *
 * Pattern intentionally mirrors `bot/command-responses.ts` — same cache
 * shape, same invalidate contract.
 */

type ToggleMap = Record<string, boolean>;

const cache = new Map<string, ToggleMap>();

function normalize(channel: string): string {
  return channel.replace(/^#/, "").toLowerCase();
}

async function loadFromDb(channel: string): Promise<ToggleMap> {
  const ch = normalize(channel);
  const [user] = await db
    .select({ commandToggles: usersTable.commandToggles })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  return (user?.commandToggles ?? {}) as ToggleMap;
}

export async function getToggleFor(
  channel: string,
  canonicalName: string,
  fallback: boolean,
): Promise<boolean> {
  const ch = normalize(channel);
  let map = cache.get(ch);
  if (!map) {
    map = await loadFromDb(ch);
    cache.set(ch, map);
  }
  const v = map[canonicalName];
  return typeof v === "boolean" ? v : fallback;
}

/** Snapshot of the channel's full override map (or `{}` if none). */
export async function getAllToggles(channel: string): Promise<ToggleMap> {
  const ch = normalize(channel);
  let map = cache.get(ch);
  if (!map) {
    map = await loadFromDb(ch);
    cache.set(ch, map);
  }
  return map;
}

export function invalidateCommandToggles(channel: string): void {
  cache.delete(normalize(channel));
}
