import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Per-channel overrides for built-in command response templates.
 *
 * Cached in-memory, keyed by lowercase channel name (== streamer's
 * `usersTable.twitchUsername`). Refresh with `invalidateCommandResponses`
 * after a successful PUT in routes/commands.ts so chat sees changes
 * without a server restart.
 *
 * The bot calls `getCustomResponseFor(channel, canonicalName)` from the
 * customizable command handlers; if it returns null, the handler falls
 * back to the built-in default (random taunt, etc).
 */

type ResponseMap = Record<string, string>;

const cache = new Map<string, ResponseMap>();

function normalize(channel: string): string {
  return channel.replace(/^#/, "").toLowerCase();
}

async function loadFromDb(channel: string): Promise<ResponseMap> {
  const ch = normalize(channel);
  const [user] = await db
    .select({ commandResponses: usersTable.commandResponses })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  return user?.commandResponses ?? {};
}

export async function getCustomResponseFor(
  channel: string,
  canonicalName: string,
): Promise<string | null> {
  const ch = normalize(channel);
  let map = cache.get(ch);
  if (!map) {
    map = await loadFromDb(ch);
    cache.set(ch, map);
  }
  const v = map[canonicalName];
  return v && v.trim().length > 0 ? v : null;
}

export function invalidateCommandResponses(channel: string): void {
  cache.delete(normalize(channel));
}

/** Substitute `{token}` placeholders. Unknown tokens are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}
