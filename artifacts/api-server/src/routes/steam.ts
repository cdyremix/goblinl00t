import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, tradeFulfillmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { MOCK_CS2_INVENTORY, MOCK_STEAM_ID64 } from "../bot/cs2-mock-data";
import { rateLimit } from "../lib/auth-helpers";

const router = Router();

interface SteamAsset {
  appid: number;
  classid: string;
  instanceid: string;
  amount: string;
  assetid: string;
}

interface SteamDescription {
  classid: string;
  instanceid: string;
  name: string;
  market_hash_name: string;
  icon_url: string;
  tradable: number;
  commodity: number;
  tags?: { category: string; internal_name: string; localized_tag_name: string; color?: string }[];
}

function getRarityColor(tags?: SteamDescription["tags"]): string {
  const rarityTag = tags?.find((t) => t.category === "Rarity");
  return rarityTag?.color ? `#${rarityTag.color}` : "#b0c3d9";
}

function getRarityName(tags?: SteamDescription["tags"]): string {
  const rarityTag = tags?.find((t) => t.category === "Rarity");
  return rarityTag?.localized_tag_name ?? "Unknown";
}

function getWearName(tags?: SteamDescription["tags"]): string | null {
  const wearTag = tags?.find((t) => t.category === "Exterior");
  return wearTag?.localized_tag_name ?? null;
}

function getTypeName(tags?: SteamDescription["tags"]): string {
  const typeTag = tags?.find((t) => t.category === "Type");
  return typeTag?.localized_tag_name ?? "";
}

// =====================================================================
// Steam OpenID 2.0 sign-in
// =====================================================================
// Steam doesn't speak OAuth — it uses OpenID 2.0. The flow is:
//   1) Redirect the user to https://steamcommunity.com/openid/login with
//      our return_to URL.
//   2) Steam authenticates them, then redirects to our return_to with
//      `openid.claimed_id` containing their SteamID64 in the URL path.
//   3) We POST those exact params back to Steam with `openid.mode=
//      check_authentication` to verify they're real (otherwise anyone
//      could craft a fake redirect).
//   4) Pull steamID64 out of claimed_id, fetch the public profile name,
//      stash both on the user record, redirect them home.
//
// The OpenID return_to URL is part of the cryptographic challenge, so we
// can't stuff the Clerk userId into it as a query param. Instead we set a
// short-lived signed cookie before the redirect that names the caller.

const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_COOKIE_NAME = "steam_oauth_clerk";

function appBaseUrl(): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  const host = domains[0] ?? "localhost";
  return `https://${host}`;
}

function steamReturnTo(): string {
  return `${appBaseUrl()}/api/steam/auth/callback`;
}

function signClerkUserId(clerkUserId: string): string {
  const exp = Date.now() + 10 * 60 * 1000; // 10 min
  const payload = `${clerkUserId}.${exp}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

function verifyClerkCookie(value: string | undefined): string | null {
  // Fail closed if the signing key isn't configured — otherwise an attacker
  // could craft a cookie with an empty-key HMAC and get it accepted.
  if (!SESSION_SECRET || !value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [clerkUserId, expStr, sig] = parts as [string, string, string];
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(`${clerkUserId}.${expStr}`).digest("hex");
    // Constant-time compare
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return clerkUserId;
  } catch {
    return null;
  }
}

// In-memory replay guard for Steam's openid.response_nonce. Steam's nonce
// is a one-time value scoped to the assertion; tracking even briefly stops
// an attacker from reusing a captured callback URL within the cookie TTL.
// Map: nonce -> expiry epoch ms. Pruned lazily on every check.
const SEEN_NONCES = new Map<string, number>();
function nonceAlreadyUsed(nonce: string): boolean {
  const now = Date.now();
  for (const [n, exp] of SEEN_NONCES) {
    if (exp < now) SEEN_NONCES.delete(n);
  }
  if (SEEN_NONCES.has(nonce)) return true;
  // Steam nonces are time-prefixed; a 15-min TTL is well past our cookie life.
  SEEN_NONCES.set(nonce, now + 15 * 60 * 1000);
  return false;
}

// Steam's check_authentication response is key:value newline-separated;
// the permissive `/is_valid:true/i` regex would also match a substring
// inside an attacker-controlled field. Parse strictly instead.
function steamSaysValid(body: string): boolean {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    if (line.slice(0, idx) === "is_valid" && line.slice(idx + 1).trim() === "true") {
      return true;
    }
  }
  return false;
}

const STEAM_CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
}

// Returns the OpenID redirect URL the frontend should send the user to.
// Sets a signed cookie carrying the Clerk userId so we can re-identify the
// caller on the OpenID callback (Steam strips everything but its own params).
router.post("/steam/auth/init", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!SESSION_SECRET) {
    res.status(500).json({ error: "SESSION_SECRET not configured" });
    return;
  }
  // Match the Twitch init throttle. Steam's OpenID flow is a top-level
  // redirect, so a runaway client could otherwise spam outbound init calls.
  if (!rateLimit(`steam-init:${userId}`, { max: 10, windowMs: 60_000 })) {
    res.status(429).json({ error: "Too many requests. Slow down." });
    return;
  }

  res.cookie(STEAM_COOKIE_NAME, signClerkUserId(userId), {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // Steam will redirect back with a top-level GET, so lax is required.
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": steamReturnTo(),
    "openid.realm": appBaseUrl(),
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  res.json({ url: `${STEAM_OPENID_URL}?${params.toString()}` });
});

router.get("/steam/auth/callback", async (req, res) => {
  // Hard fail if the signing key is missing — without it `verifyClerkCookie`
  // can't trust any cookie, and we must never silently accept an unsigned
  // (or empty-key-signed) session.
  if (!SESSION_SECRET) {
    res.status(500).send("Steam sign-in is not configured (missing SESSION_SECRET).");
    return;
  }
  const cookieValue = parseCookie(req.headers.cookie, STEAM_COOKIE_NAME);
  const clerkUserId = verifyClerkCookie(cookieValue);
  if (!clerkUserId) {
    res.status(400).send("Steam sign-in session expired. Please try again.");
    return;
  }

  // Verify the OpenID assertion with Steam by echoing every openid.* param
  // back with mode=check_authentication. Steam responds with `is_valid:true`
  // only if the response really came from them.
  const verifyParams = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k.startsWith("openid.") && typeof v === "string") verifyParams.set(k, v);
  }
  verifyParams.set("openid.mode", "check_authentication");

  const verifyRes = await fetch(STEAM_OPENID_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });

  if (!verifyRes.ok) {
    res.status(502).send("Steam verification failed (network).");
    return;
  }
  const verifyText = await verifyRes.text();
  if (!steamSaysValid(verifyText)) {
    res.status(403).send("Steam rejected the sign-in (could not verify identity).");
    return;
  }

  // Replay guard: refuse reuse of the same OpenID response_nonce within its
  // TTL window. Even with a valid signed cookie and a valid Steam assertion,
  // a captured callback URL must only work once.
  const responseNonce = req.query["openid.response_nonce"];
  if (typeof responseNonce !== "string" || nonceAlreadyUsed(responseNonce)) {
    res.status(403).send("Steam sign-in already consumed (replay rejected).");
    return;
  }

  const claimedId = req.query["openid.claimed_id"];
  if (typeof claimedId !== "string") {
    res.status(400).send("Steam did not return a claimed_id.");
    return;
  }
  // Strict host+path match — refuse anything that isn't exactly Steam's
  // canonical SteamID64 URL. The previous loose regex would have accepted
  // any URL ending `/openid/id/<digits>`, including attacker-controlled hosts.
  const match = claimedId.match(STEAM_CLAIMED_ID_RE);
  const steamId64 = match?.[1];
  if (!steamId64) {
    res.status(400).send("Could not parse SteamID from claimed_id.");
    return;
  }

  // Fetch the user's profile name from Steam's public XML endpoint (no API
  // key required). Best-effort — fall back to the steamID if it fails.
  let steamUsername: string | null = null;
  try {
    const profileRes = await fetch(`https://steamcommunity.com/profiles/${steamId64}/?xml=1`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GoblinL00tBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (profileRes.ok) {
      const xml = await profileRes.text();
      const nameMatch = xml.match(/<steamID>(?:<!\[CDATA\[([^\]]+)\]\]>|([^<]+))<\/steamID>/);
      steamUsername = nameMatch?.[1] ?? nameMatch?.[2] ?? null;
    }
  } catch {
    // ignore — username is cosmetic
  }

  await db
    .update(usersTable)
    .set({ steamId64, steamUsername: steamUsername ?? `Steam User ${steamId64.slice(-4)}` })
    .where(eq(usersTable.clerkUserId, clerkUserId));

  // Clear the temp cookie
  res.clearCookie(STEAM_COOKIE_NAME, { path: "/" });
  res.redirect(`${appBaseUrl()}/settings?connected=steam`);
});

router.post("/steam/disconnect", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  await db
    .update(usersTable)
    .set({ steamId64: null, steamUsername: null })
    .where(eq(usersTable.clerkUserId, userId));

  res.json({ success: true });
});

router.get("/steam/inventory", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId)).limit(1);
  if (!user?.steamId64) {
    res.status(400).json({ error: "Steam account not connected. Click 'Connect Steam' in settings." });
    return;
  }

  // Test/dev mode: return mock CS2 inventory for the legacy mock account.
  if (user.steamId64 === MOCK_STEAM_ID64) {
    res.json({ items: MOCK_CS2_INVENTORY, totalCount: MOCK_CS2_INVENTORY.length });
    return;
  }

  // Real Steam community inventory fetch
  try {
    const url = `https://steamcommunity.com/inventory/${user.steamId64}/730/2?l=english&count=200`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GoblinL00tBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 403) {
        res.status(400).json({ error: "Steam inventory is private. Set your inventory to public in Steam privacy settings." });
      } else {
        res.status(502).json({ error: `Steam returned ${response.status}. Try again shortly.` });
      }
      return;
    }

    const data = await response.json() as {
      assets?: SteamAsset[];
      descriptions?: SteamDescription[];
      total_inventory_count?: number;
    };

    if (!data.assets || !data.descriptions) {
      res.json({ items: [], totalCount: 0 });
      return;
    }

    const descMap = new Map<string, SteamDescription>();
    for (const d of data.descriptions) {
      descMap.set(`${d.classid}_${d.instanceid}`, d);
    }

    const items = data.assets
      .map((asset) => {
        const desc = descMap.get(`${asset.classid}_${asset.instanceid}`);
        if (!desc) return null;
        return {
          assetId: asset.assetid,
          classId: asset.classid,
          name: desc.name,
          marketHashName: desc.market_hash_name,
          iconUrl: `https://steamcommunity-a.akamaihd.net/economy/image/${desc.icon_url}/256x256`,
          tradable: desc.tradable === 1,
          rarityColor: getRarityColor(desc.tags),
          rarityName: getRarityName(desc.tags),
          wear: getWearName(desc.tags),
          type: getTypeName(desc.tags),
        };
      })
      .filter(Boolean);

    res.json({ items, totalCount: data.total_inventory_count ?? items.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Failed to fetch Steam inventory: ${msg}` });
  }
});

router.post("/steam/submit-trade-url", async (req, res) => {
  const body = req.body as { twitchUsername: string; tradeUrl: string };
  if (!body.twitchUsername || !body.tradeUrl) {
    res.status(400).json({ error: "twitchUsername and tradeUrl required" });
    return;
  }
  if (!body.tradeUrl.includes("steamcommunity.com/tradeoffer/new/")) {
    res.status(400).json({ error: "Invalid Steam trade URL" });
    return;
  }

  const [fulfillment] = await db
    .select()
    .from(tradeFulfillmentsTable)
    .where(
      and(
        eq(tradeFulfillmentsTable.winnerTwitchUsername, body.twitchUsername),
        eq(tradeFulfillmentsTable.status, "pending")
      )
    )
    .limit(1);

  if (!fulfillment) {
    res.status(404).json({ error: "No pending trade found for this user" });
    return;
  }

  const [updated] = await db
    .update(tradeFulfillmentsTable)
    .set({ steamTradeUrl: body.tradeUrl })
    .where(eq(tradeFulfillmentsTable.id, fulfillment.id))
    .returning();

  res.json({ success: true, fulfillmentId: updated!.id });
});

export default router;
