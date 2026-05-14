import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { THEMES, type BotTheme, type ThemePhrases } from "./bot-themes";

/**
 * In-memory cache of per-channel bot theme. Mirrors the pattern in
 * `channel-settings.ts` — bot chat handler hits this on every message,
 * so the cache is critical to avoid a DB roundtrip per chat line.
 *
 * The cache is keyed by lowercase channel name (== owner's
 * `usersTable.twitchUsername`). Settings PUT MUST call
 * `invalidateChannelTheme(channel)` after writing `botTheme` so the
 * next chat line picks up the new theme.
 *
 * Replaces the module-global `_activeTheme` in `bot-themes.ts` which
 * leaked theme state across every streamer the bot served — a streamer
 * switching to CS2 mode would have flipped every other channel's chat
 * to CS2 phrasing too.
 */

const DEFAULT_THEME: BotTheme = "goblin";

const cache = new Map<string, BotTheme>();

function normalize(channel: string): string {
  return channel.replace(/^#/, "").toLowerCase();
}

async function loadFromDb(channel: string): Promise<BotTheme> {
  const ch = normalize(channel);
  const [user] = await db
    .select({ botTheme: usersTable.botTheme })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  const t = user?.botTheme;
  const VALID_THEMES: BotTheme[] = ["goblin", "cs2", "hearthstone"];
  return (t && VALID_THEMES.includes(t as BotTheme)) ? (t as BotTheme) : DEFAULT_THEME;
}

export async function getChannelTheme(channel: string): Promise<BotTheme> {
  const ch = normalize(channel);
  const hit = cache.get(ch);
  if (hit) return hit;
  const fresh = await loadFromDb(ch);
  cache.set(ch, fresh);
  return fresh;
}

export async function getChannelThemePhrases(channel: string): Promise<ThemePhrases> {
  const theme = await getChannelTheme(channel);
  return THEMES[theme];
}

/** Force a re-read on next access. Call from settings PUT handlers. */
export function invalidateChannelTheme(channel: string): void {
  cache.delete(normalize(channel));
}
