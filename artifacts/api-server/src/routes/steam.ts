import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, tradeFulfillmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

router.get("/steam/inventory", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId)).limit(1);
  if (!user?.steamId64) {
    res.status(400).json({ error: "No Steam ID configured. Add your Steam ID 64 in settings." });
    return;
  }

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

// Winners submit their Steam trade URL via bot command or this endpoint
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

  // Find the most recent pending fulfillment for this winner
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
