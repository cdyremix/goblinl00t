export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type LootTheme = "goblin" | "cs2";

interface LootItem {
  item: string;
  rarity: Rarity;
  points: number;
  theme: LootTheme;
}

export const LOOT_TABLE: LootItem[] = [
  // ============== GOBLIN HOARD THEME ==============
  // Common (50% chance)
  { item: "Rusty Nail", rarity: "common", points: 5, theme: "goblin" },
  { item: "Shiny Pebble", rarity: "common", points: 5, theme: "goblin" },
  { item: "Old Boot", rarity: "common", points: 3, theme: "goblin" },
  { item: "Broken Spoon", rarity: "common", points: 3, theme: "goblin" },
  { item: "Smelly Cheese", rarity: "common", points: 4, theme: "goblin" },
  { item: "Bent Coin", rarity: "common", points: 6, theme: "goblin" },
  { item: "Muddy Stick", rarity: "common", points: 2, theme: "goblin" },
  { item: "Half a Sandwich", rarity: "common", points: 7, theme: "goblin" },
  { item: "Crumpled Receipt", rarity: "common", points: 1, theme: "goblin" },
  { item: "Moldy Bread", rarity: "common", points: 2, theme: "goblin" },

  // Uncommon (30% chance)
  { item: "Goblin Gold Tooth", rarity: "uncommon", points: 25, theme: "goblin" },
  { item: "Tattered Map Fragment", rarity: "uncommon", points: 20, theme: "goblin" },
  { item: "Sparkly Rock", rarity: "uncommon", points: 30, theme: "goblin" },
  { item: "Magic Mushroom", rarity: "uncommon", points: 35, theme: "goblin" },
  { item: "Rusted Dagger", rarity: "uncommon", points: 40, theme: "goblin" },
  { item: "Strange Potion", rarity: "uncommon", points: 45, theme: "goblin" },
  { item: "Lucky Clover", rarity: "uncommon", points: 50, theme: "goblin" },

  // Rare (15% chance)
  { item: "Enchanted Ring", rarity: "rare", points: 100, theme: "goblin" },
  { item: "Dragon Scale", rarity: "rare", points: 120, theme: "goblin" },
  { item: "Ancient Coin", rarity: "rare", points: 150, theme: "goblin" },
  { item: "Glowing Orb", rarity: "rare", points: 175, theme: "goblin" },
  { item: "Goblin's Precious", rarity: "rare", points: 200, theme: "goblin" },

  // Epic (4% chance)
  { item: "Phoenix Feather", rarity: "epic", points: 500, theme: "goblin" },
  { item: "Void Crystal", rarity: "epic", points: 600, theme: "goblin" },
  { item: "Goblin King's Scepter", rarity: "epic", points: 750, theme: "goblin" },
  { item: "Time Stolen Watch", rarity: "epic", points: 800, theme: "goblin" },

  // Legendary (1% chance)
  { item: "ULTIMATE SHINYYY!!!!", rarity: "legendary", points: 5000, theme: "goblin" },
  { item: "Goblin's Sacred Hoard Key", rarity: "legendary", points: 3000, theme: "goblin" },
  { item: "Chaos Gem of Doom", rarity: "legendary", points: 4000, theme: "goblin" },

  // ============== CS2 ARMS DEAL THEME ==============
  // Common — Consumer / Industrial Grade
  { item: "Glock-18 | Sand Dune", rarity: "common", points: 4, theme: "cs2" },
  { item: "P250 | Sand Dune", rarity: "common", points: 3, theme: "cs2" },
  { item: "MAG-7 | Storm", rarity: "common", points: 5, theme: "cs2" },
  { item: "MP9 | Storm", rarity: "common", points: 4, theme: "cs2" },
  { item: "UMP-45 | Mudder", rarity: "common", points: 6, theme: "cs2" },
  { item: "Negev | Army Sheen", rarity: "common", points: 3, theme: "cs2" },
  { item: "PP-Bizon | Forest Leaves", rarity: "common", points: 5, theme: "cs2" },
  { item: "Sealed Graffiti", rarity: "common", points: 2, theme: "cs2" },
  { item: "Sticker Capsule", rarity: "common", points: 7, theme: "cs2" },
  { item: "Cracked Phoenix Sticker", rarity: "common", points: 1, theme: "cs2" },

  // Uncommon — Mil-Spec Blue
  { item: "AK-47 | Safari Mesh", rarity: "uncommon", points: 25, theme: "cs2" },
  { item: "M4A4 | Faded Zebra", rarity: "uncommon", points: 30, theme: "cs2" },
  { item: "Desert Eagle | Mudder", rarity: "uncommon", points: 35, theme: "cs2" },
  { item: "USP-S | Forest Leaves", rarity: "uncommon", points: 40, theme: "cs2" },
  { item: "AWP | Safari Mesh", rarity: "uncommon", points: 45, theme: "cs2" },
  { item: "P90 | Storm", rarity: "uncommon", points: 30, theme: "cs2" },
  { item: "FAMAS | Colony", rarity: "uncommon", points: 50, theme: "cs2" },

  // Rare — Restricted Purple
  { item: "Glock-18 | Water Elemental", rarity: "rare", points: 100, theme: "cs2" },
  { item: "AK-47 | Redline", rarity: "rare", points: 150, theme: "cs2" },
  { item: "M4A1-S | Cyrex", rarity: "rare", points: 175, theme: "cs2" },
  { item: "USP-S | Kill Confirmed", rarity: "rare", points: 200, theme: "cs2" },
  { item: "P250 | Asiimov", rarity: "rare", points: 120, theme: "cs2" },

  // Epic — Classified Pink / Covert Red
  { item: "AK-47 | Asiimov", rarity: "epic", points: 600, theme: "cs2" },
  { item: "AWP | Hyper Beast", rarity: "epic", points: 750, theme: "cs2" },
  { item: "M4A4 | Howl (Contraband)", rarity: "epic", points: 800, theme: "cs2" },
  { item: "Desert Eagle | Blaze", rarity: "epic", points: 500, theme: "cs2" },

  // Legendary — Knife / Gloves (Rare Special Item)
  { item: "★ Karambit | Doppler", rarity: "legendary", points: 5000, theme: "cs2" },
  { item: "★ Butterfly Knife | Fade", rarity: "legendary", points: 4500, theme: "cs2" },
  { item: "★ Sport Gloves | Pandora's Box", rarity: "legendary", points: 3500, theme: "cs2" },
];

const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1,
};

export function rollLoot(theme: LootTheme = "goblin"): LootItem {
  const roll = Math.random() * 100;
  let rarity: Rarity;

  if (roll < 1) rarity = "legendary";
  else if (roll < 5) rarity = "epic";
  else if (roll < 20) rarity = "rare";
  else if (roll < 50) rarity = "uncommon";
  else rarity = "common";

  const pool = LOOT_TABLE.filter((item) => item.rarity === rarity && item.theme === theme);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function getRarityEmoji(rarity: Rarity): string {
  const emojis: Record<Rarity, string> = {
    common: "⚪",
    uncommon: "🟢",
    rare: "🔵",
    epic: "🟣",
    legendary: "🟡",
  };
  return emojis[rarity];
}

export { RARITY_WEIGHTS };
