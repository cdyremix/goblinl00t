// CS2 agent names — used as default bot display names in CS2 theme.
export const CS2_AGENT_NAMES = [
  "Trapper",
  "Operator",
  "Slingshot",
  "Aspirant",
  "Markus",
  "Syfers",
  "Ricksaw",
  "Farlow",
  "Bloody Darryl",
  "Dead Cold",
  "Special Agent Ava",
  "The Doctor",
  "Sir Bloody",
  "Cmdr. Mae",
] as const;

export function randomCS2AgentName(): string {
  const i = Math.floor(Math.random() * CS2_AGENT_NAMES.length);
  return CS2_AGENT_NAMES[i]!;
}

// Mock CS2 inventory used in test/dev mode after a Steam "connect".
export interface MockCS2Item {
  assetId: string;
  classId: string;
  name: string;
  marketHashName: string;
  iconUrl: string;
  tradable: boolean;
  rarityColor: string;
  rarityName: string;
  wear: string | null;
  type: string;
}

export const MOCK_CS2_INVENTORY: MockCS2Item[] = [
  { assetId: "1001", classId: "c1", name: "AWP | Dragon Lore", marketHashName: "AWP | Dragon Lore (Field-Tested)", iconUrl: "", tradable: false, rarityColor: "#eb4b4b", rarityName: "Covert", wear: "Field-Tested", type: "Sniper Rifle" },
  { assetId: "1002", classId: "c2", name: "AK-47 | Asiimov", marketHashName: "AK-47 | Asiimov (Minimal Wear)", iconUrl: "", tradable: true, rarityColor: "#eb4b4b", rarityName: "Covert", wear: "Minimal Wear", type: "Rifle" },
  { assetId: "1003", classId: "c3", name: "★ Karambit | Doppler", marketHashName: "★ Karambit | Doppler (Factory New)", iconUrl: "", tradable: true, rarityColor: "#e4ae39", rarityName: "★ Covert Knife", wear: "Factory New", type: "★ Knife" },
  { assetId: "1004", classId: "c4", name: "M4A4 | Howl", marketHashName: "M4A4 | Howl (Field-Tested)", iconUrl: "", tradable: true, rarityColor: "#eb4b4b", rarityName: "Contraband", wear: "Field-Tested", type: "Rifle" },
  { assetId: "1005", classId: "c5", name: "Glock-18 | Fade", marketHashName: "Glock-18 | Fade (Factory New)", iconUrl: "", tradable: true, rarityColor: "#d32ce6", rarityName: "Classified", wear: "Factory New", type: "Pistol" },
  { assetId: "1006", classId: "c6", name: "USP-S | Kill Confirmed", marketHashName: "USP-S | Kill Confirmed (Minimal Wear)", iconUrl: "", tradable: true, rarityColor: "#eb4b4b", rarityName: "Covert", wear: "Minimal Wear", type: "Pistol" },
  { assetId: "1007", classId: "c7", name: "Desert Eagle | Blaze", marketHashName: "Desert Eagle | Blaze (Factory New)", iconUrl: "", tradable: true, rarityColor: "#d32ce6", rarityName: "Classified", wear: "Factory New", type: "Pistol" },
  { assetId: "1008", classId: "c8", name: "AK-47 | Redline", marketHashName: "AK-47 | Redline (Field-Tested)", iconUrl: "", tradable: true, rarityColor: "#d32ce6", rarityName: "Classified", wear: "Field-Tested", type: "Rifle" },
  { assetId: "1009", classId: "c9", name: "M4A1-S | Hyper Beast", marketHashName: "M4A1-S | Hyper Beast (Minimal Wear)", iconUrl: "", tradable: false, rarityColor: "#d32ce6", rarityName: "Classified", wear: "Minimal Wear", type: "Rifle" },
  { assetId: "1010", classId: "c10", name: "AWP | Asiimov", marketHashName: "AWP | Asiimov (Field-Tested)", iconUrl: "", tradable: true, rarityColor: "#eb4b4b", rarityName: "Covert", wear: "Field-Tested", type: "Sniper Rifle" },
  { assetId: "1011", classId: "c11", name: "★ Butterfly Knife | Crimson Web", marketHashName: "★ Butterfly Knife | Crimson Web (Minimal Wear)", iconUrl: "", tradable: true, rarityColor: "#e4ae39", rarityName: "★ Covert Knife", wear: "Minimal Wear", type: "★ Knife" },
  { assetId: "1012", classId: "c12", name: "P250 | See Ya Later", marketHashName: "P250 | See Ya Later (Factory New)", iconUrl: "", tradable: true, rarityColor: "#8847ff", rarityName: "Restricted", wear: "Factory New", type: "Pistol" },
  { assetId: "1013", classId: "c13", name: "Galil AR | Cerberus", marketHashName: "Galil AR | Cerberus (Field-Tested)", iconUrl: "", tradable: true, rarityColor: "#d32ce6", rarityName: "Classified", wear: "Field-Tested", type: "Rifle" },
  { assetId: "1014", classId: "c14", name: "FAMAS | Roll Cage", marketHashName: "FAMAS | Roll Cage (Minimal Wear)", iconUrl: "", tradable: true, rarityColor: "#8847ff", rarityName: "Restricted", wear: "Minimal Wear", type: "Rifle" },
  { assetId: "1015", classId: "c15", name: "MAC-10 | Neon Rider", marketHashName: "MAC-10 | Neon Rider (Factory New)", iconUrl: "", tradable: true, rarityColor: "#8847ff", rarityName: "Restricted", wear: "Factory New", type: "SMG" },
];

// Indicates a "test connected" Steam account when no real OAuth is configured.
export const MOCK_STEAM_ID64 = "76561198000000001";
export const MOCK_STEAM_USERNAME = "ProGamer42";
