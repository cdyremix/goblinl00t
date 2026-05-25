/**
 * Complete list of built-in bot command keywords (without the `!` prefix).
 * Mirrors the `BUILT_IN_COMMANDS` keys in `artifacts/api-server/src/bot/bot-service.ts`.
 *
 * Used in the giveaway keyword field and the custom command creation form to
 * show an immediate "already taken" error before the request even hits the server.
 */
export const RESERVED_BOT_KEYWORDS = new Set([
  "loot",
  "enter",
  "giveaway",
  "inventory",
  "sell",
  "use",
  "help",
  "coins",
  "redeem",
  "goblin",
  "steal",
  "feed",
  // CS2 / Hearthstone aliases
  "skin",
  "scam",
  "case",
  "innkeeper",
  "brew",
  // Other built-ins
  "tradeurl",
  "top",
  "gift",
]);

/** Strip a leading `!` and lowercase, then check against the reserved set. */
export function isReservedKeyword(input: string): boolean {
  return RESERVED_BOT_KEYWORDS.has(input.replace(/^!/, "").toLowerCase());
}
