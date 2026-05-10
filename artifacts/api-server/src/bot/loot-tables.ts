export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

interface LootItem {
  item: string;
  rarity: Rarity;
  points: number;
}

const LOOT_TABLE: LootItem[] = [
  // Common (50% chance)
  { item: "Rusty Nail", rarity: "common", points: 5 },
  { item: "Shiny Pebble", rarity: "common", points: 5 },
  { item: "Old Boot", rarity: "common", points: 3 },
  { item: "Broken Spoon", rarity: "common", points: 3 },
  { item: "Smelly Cheese", rarity: "common", points: 4 },
  { item: "Bent Coin", rarity: "common", points: 6 },
  { item: "Muddy Stick", rarity: "common", points: 2 },
  { item: "Half a Sandwich", rarity: "common", points: 7 },
  { item: "Crumpled Receipt", rarity: "common", points: 1 },
  { item: "Moldy Bread", rarity: "common", points: 2 },

  // Uncommon (30% chance)
  { item: "Goblin Gold Tooth", rarity: "uncommon", points: 25 },
  { item: "Tattered Map Fragment", rarity: "uncommon", points: 20 },
  { item: "Sparkly Rock", rarity: "uncommon", points: 30 },
  { item: "Magic Mushroom", rarity: "uncommon", points: 35 },
  { item: "Rusted Dagger", rarity: "uncommon", points: 40 },
  { item: "Strange Potion", rarity: "uncommon", points: 45 },
  { item: "Lucky Clover", rarity: "uncommon", points: 50 },

  // Rare (15% chance)
  { item: "Enchanted Ring", rarity: "rare", points: 100 },
  { item: "Dragon Scale", rarity: "rare", points: 120 },
  { item: "Ancient Coin", rarity: "rare", points: 150 },
  { item: "Glowing Orb", rarity: "rare", points: 175 },
  { item: "Goblin's Precious", rarity: "rare", points: 200 },

  // Epic (4% chance)
  { item: "Phoenix Feather", rarity: "epic", points: 500 },
  { item: "Void Crystal", rarity: "epic", points: 600 },
  { item: "Goblin King's Scepter", rarity: "epic", points: 750 },
  { item: "Time Stolen Watch", rarity: "epic", points: 800 },

  // Legendary (1% chance)
  { item: "ULTIMATE SHINYYY!!!!", rarity: "legendary", points: 5000 },
  { item: "Goblin's Sacred Hoard Key", rarity: "legendary", points: 3000 },
  { item: "Chaos Gem of Doom", rarity: "legendary", points: 4000 },
];

const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1,
};

export function rollLoot(): LootItem {
  const roll = Math.random() * 100;
  let rarity: Rarity;

  if (roll < 1) rarity = "legendary";
  else if (roll < 5) rarity = "epic";
  else if (roll < 20) rarity = "rare";
  else if (roll < 50) rarity = "uncommon";
  else rarity = "common";

  const pool = LOOT_TABLE.filter((item) => item.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
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
