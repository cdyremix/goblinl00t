import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI ?? "";

function buildTwitchAuthUrl(clerkUserId: string): string {
  const state = Buffer.from(JSON.stringify({ userId: clerkUserId })).toString("base64url");
  const scopes = "chat:read chat:edit channel:manage:broadcast";
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

// Step 1 — return the Twitch OAuth URL the frontend should send the user to.
// We *return JSON* rather than `res.redirect()` because the previous flow
// triggered the redirect from a top-level `<a href>`, which doesn't carry
// the Clerk Bearer token; Clerk's session cookie isn't reliably set on the
// API origin under the proxy setup, so the route would 401 and the button
// silently did nothing for users. Frontend now does
// `authedFetch('/api/auth/twitch')` then `window.location.assign(url)`.
router.get("/auth/twitch", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!CLIENT_ID || !REDIRECT_URI) {
    res.status(500).json({ error: "Twitch OAuth is not configured (missing TWITCH_CLIENT_ID / TWITCH_REDIRECT_URI)." });
    return;
  }
  res.json({ url: buildTwitchAuthUrl(userId) });
});

// Step 2 — Twitch redirects back here
router.get("/auth/twitch/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  if (!code || !state) { res.status(400).send("Missing code or state"); return; }

  let clerkUserId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as { userId: string };
    clerkUserId = parsed.userId;
  } catch {
    res.status(400).send("Invalid state");
    return;
  }

  // Exchange code for token
  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    res.status(500).send("Failed to exchange token");
    return;
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; refresh_token: string };

  // Get Twitch user info
  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Client-Id": CLIENT_ID,
    },
  });

  const userData = (await userRes.json()) as { data: Array<{ id: string; login: string }> };
  const twitchUser = userData.data[0];
  if (!twitchUser) { res.status(500).send("Failed to fetch Twitch user"); return; }

  // Upsert user record
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  if (existing) {
    await db.update(usersTable).set({
      twitchUserId: twitchUser.id,
      twitchUsername: twitchUser.login,
      twitchAccessToken: tokenData.access_token,
      twitchRefreshToken: tokenData.refresh_token,
    }).where(eq(usersTable.clerkUserId, clerkUserId));
  } else {
    await db.insert(usersTable).values({
      clerkUserId,
      twitchUserId: twitchUser.id,
      twitchUsername: twitchUser.login,
      twitchAccessToken: tokenData.access_token,
      twitchRefreshToken: tokenData.refresh_token,
    });
  }

  // Redirect back to the channel tab so the user lands on the binding card.
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",");
  const host = domains[0] ?? "localhost";
  res.redirect(`https://${host}/account?tab=channel&connected=twitch`);
});

export default router;
