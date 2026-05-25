import { logger } from "../lib/logger";

const HELIX_BASE = "https://api.twitch.tv/helix";

const userIdCache = new Map<string, string>();
let resolvedBotUserId: string | null = null;

async function helixGetUserId(login: string): Promise<string | null> {
  const lower = login.toLowerCase();
  const cached = userIdCache.get(lower);
  if (cached) return cached;

  const token = process.env["TWITCH_OAUTH_TOKEN"];
  const clientId = process.env["TWITCH_CLIENT_ID"];
  if (!token || !clientId) return null;

  try {
    const resp = await fetch(
      `${HELIX_BASE}/users?login=${encodeURIComponent(lower)}`,
      {
        headers: {
          Authorization: `Bearer ${token.replace(/^oauth:/i, "")}`,
          "Client-Id": clientId,
        },
      }
    );
    if (!resp.ok) {
      logger.warn({ status: resp.status, login }, "helixWhisper: getUserId response not ok");
      return null;
    }
    const body = (await resp.json()) as { data: { id: string; login: string }[] };
    const user = body.data[0];
    if (!user) return null;
    userIdCache.set(user.login.toLowerCase(), user.id);
    return user.id;
  } catch (err) {
    logger.warn({ err: (err as Error).message, login }, "helixWhisper: getUserId threw");
    return null;
  }
}

async function getBotUserId(): Promise<string | null> {
  if (resolvedBotUserId) return resolvedBotUserId;
  const botLogin = process.env["TWITCH_BOT_USERNAME"];
  if (!botLogin) return null;
  resolvedBotUserId = await helixGetUserId(botLogin);
  return resolvedBotUserId;
}

/**
 * Send a private whisper via the Twitch Helix API.
 *
 * Pre-requisites (Twitch-side):
 *   – TWITCH_OAUTH_TOKEN must include `user:manage:whispers` scope.
 *   – The bot account must have a verified phone number on Twitch.
 *   – The recipient must not block whispers and ideally must have
 *     previously whispered the bot, or the bot must be a mod in their
 *     channel (Twitch restriction as of 2023).
 *
 * Returns true when Twitch accepted the request (HTTP 204), false
 * otherwise. Callers fall back to public chat on false.
 */
export async function helixWhisper(toUsername: string, message: string): Promise<boolean> {
  const token = process.env["TWITCH_OAUTH_TOKEN"];
  const clientId = process.env["TWITCH_CLIENT_ID"];
  if (!token || !clientId) return false;

  try {
    const fromId = await getBotUserId();
    const toId = await helixGetUserId(toUsername);
    if (!fromId || !toId) return false;

    const resp = await fetch(
      `${HELIX_BASE}/whispers?from_user_id=${encodeURIComponent(fromId)}&to_user_id=${encodeURIComponent(toId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.replace(/^oauth:/i, "")}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      }
    );

    if (resp.status === 204 || resp.ok) return true;

    const bodyText = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, body: bodyText.slice(0, 300), toUsername },
      "helixWhisper: Twitch rejected whisper"
    );
    return false;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, toUsername },
      "helixWhisper: request threw"
    );
    return false;
  }
}
