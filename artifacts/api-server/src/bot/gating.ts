import type { ChatUserstate } from "tmi.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface Gateable {
  channel: string;
  requireFollower: boolean;
  subscriberOnly: boolean;
  minSubTier: string | null;
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

const TIER_LABEL: Record<string, string> = {
  "1000": "Tier 1",
  "2000": "Tier 2",
  "3000": "Tier 3",
};

function getSubTierFromTags(tags: ChatUserstate): string | null {
  if (!tags.subscriber) return null;
  // Twitch IRC encodes the subscriber badge variant as the value of `badges.subscriber`.
  // For Tier 2 / Tier 3 subs, the value is exactly "2000" / "3000". For Tier 1 subs the
  // value is the months-subscribed badge variant (0, 3, 6, 12, ...). Tenure (months)
  // for any tier lives in `badge-info.subscriber`, which we ignore for tier detection.
  // So: only "2000" / "3000" reliably indicate a higher tier; anything else is Tier 1.
  const subBadge = tags.badges?.subscriber;
  if (subBadge === "3000") return "3000";
  if (subBadge === "2000") return "2000";
  return "1000";
}

async function isFollower(channel: string, viewerUserId: string): Promise<boolean | null> {
  // Best-effort follower check via Twitch Helix.
  // Returns null when we can't determine (no token / no broadcaster id) — caller treats as allow.
  const clientId = process.env["TWITCH_CLIENT_ID"];
  const appToken = process.env["TWITCH_OAUTH_TOKEN"];
  if (!clientId || !appToken) return null;

  const channelName = channel.replace(/^#/, "");
  try {
    // Look up our broadcaster's stored helix user id
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.twitchUsername, channelName))
      .limit(1);
    const broadcasterId = (user as unknown as { twitchUserId?: string } | undefined)?.twitchUserId;
    if (!broadcasterId) return null;

    const token = appToken.replace(/^oauth:/, "");
    const url = `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${viewerUserId}`;
    const r = await fetch(url, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) {
      logger.warn({ status: r.status }, "Helix followers check failed");
      return null;
    }
    const data = (await r.json()) as { total?: number; data?: unknown[] };
    return Array.isArray(data.data) && data.data.length > 0;
  } catch (err) {
    logger.warn({ err }, "Follower check errored — treating as allow");
    return null;
  }
}

export async function checkGating(g: Gateable, tags: ChatUserstate, channel: string): Promise<GateResult> {
  // Broadcaster + mods bypass gating.
  const isBroadcaster = Boolean(tags.badges?.broadcaster);
  const isMod = Boolean(tags.mod || tags.badges?.moderator);
  if (isBroadcaster || isMod) return { allowed: true };

  if (g.subscriberOnly) {
    const tier = getSubTierFromTags(tags);
    if (!tier) {
      return { allowed: false, reason: "This giveaway is subscribers-only." };
    }
    if (g.minSubTier && Number(tier) < Number(g.minSubTier)) {
      return { allowed: false, reason: `This giveaway requires ${TIER_LABEL[g.minSubTier] ?? g.minSubTier} subscribers or higher.` };
    }
  }

  if (g.requireFollower) {
    const viewerId = tags["user-id"];
    if (!viewerId) return { allowed: true }; // no id → can't verify, allow
    const ok = await isFollower(channel, viewerId);
    if (ok === false) {
      return { allowed: false, reason: "You must follow the channel to enter this giveaway." };
    }
    // ok === null means the bot couldn't verify (no app creds) — fall through and allow.
  }

  return { allowed: true };
}
