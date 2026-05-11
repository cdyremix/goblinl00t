export interface AvatarPreset {
  id: string;
  emoji: string;
  label: string;
  bg: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "goblin", emoji: "👹", label: "Goblin", bg: "from-emerald-600 to-emerald-900" },
  { id: "ogre", emoji: "👺", label: "Ogre", bg: "from-red-600 to-red-900" },
  { id: "wizard", emoji: "🧙", label: "Wizard", bg: "from-purple-600 to-purple-900" },
  { id: "knight", emoji: "⚔️", label: "Knight", bg: "from-slate-500 to-slate-800" },
  { id: "rogue", emoji: "🏹", label: "Rogue", bg: "from-amber-600 to-amber-900" },
  { id: "king", emoji: "👑", label: "King", bg: "from-yellow-500 to-amber-700" },
];

export function getAvatarPreset(id: string | null | undefined): AvatarPreset | null {
  if (!id) return null;
  return AVATAR_PRESETS.find((p) => p.id === id) ?? null;
}
