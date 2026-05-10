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

export const GOBLIN_DEFAULT_NAME = "GoblinL00t";

export function defaultBotNameFor(theme: "goblin" | "cs2"): string {
  return theme === "cs2" ? randomCS2AgentName() : GOBLIN_DEFAULT_NAME;
}

// Used to detect if the user has a "default" name (so we can auto-swap on theme change).
export function isThemeDefaultName(name: string, theme: "goblin" | "cs2"): boolean {
  if (theme === "goblin") return name === GOBLIN_DEFAULT_NAME;
  return CS2_AGENT_NAMES.includes(name as typeof CS2_AGENT_NAMES[number]);
}
