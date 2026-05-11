import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Fire a Discord-formatted webhook announcing a giveaway winner. Resolves
 * the streamer's configured `discordWebhookUrl` from the channel name; no-op
 * when the streamer hasn't set one. Failures are logged at warn level and
 * never propagate — the giveaway end path must not depend on Discord being
 * reachable.
 */
export async function fireDiscordWebhook(opts: {
  channel: string;
  title: string;
  prize: string;
  winner: string;
  entryCount: number;
}): Promise<void> {
  try {
    const [user] = await db
      .select({ url: usersTable.discordWebhookUrl })
      .from(usersTable)
      .where(eq(usersTable.twitchUsername, opts.channel))
      .limit(1);
    const url = user?.url;
    if (!url) return;
    if (!/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
      logger.warn({ channel: opts.channel }, "Refusing to call non-Discord webhook URL");
      return;
    }
    const body = {
      embeds: [
        {
          title: `🏆 Giveaway: ${opts.title}`,
          description: `**Winner:** ${opts.winner}\n**Prize:** ${opts.prize}\n**Entries:** ${opts.entryCount}`,
          color: 0xf5aa1e,
          footer: { text: "Goblin L00t" },
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ channel: opts.channel, status: res.status }, "Discord webhook returned non-2xx");
    }
  } catch (err) {
    // Log only the error name/message, NOT the raw error object — fetch
    // network errors can include the full request URL (i.e. the secret
    // webhook token) in some node versions, and we don't want that in logs.
    const errName = err instanceof Error ? err.name : "UnknownError";
    const errMessage = err instanceof Error ? err.message : "non-error thrown";
    logger.warn(
      { channel: opts.channel, errName, errMessage },
      "Discord webhook failed",
    );
  }
}
