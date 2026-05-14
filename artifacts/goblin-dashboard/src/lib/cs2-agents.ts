// Default bot display names per theme.
export const GOBLIN_DEFAULT_NAME = "Goblin L00t";
export const CS2_DEFAULT_NAME = "Number K";
export const HS_DEFAULT_NAME = "The Innkeeper";

export function defaultBotNameFor(theme: "goblin" | "cs2" | "hearthstone"): string {
  if (theme === "cs2") return CS2_DEFAULT_NAME;
  if (theme === "hearthstone") return HS_DEFAULT_NAME;
  return GOBLIN_DEFAULT_NAME;
}

// True if the given name is one of the built-in theme defaults (any theme).
export function isAnyThemeDefault(name: string): boolean {
  return name === GOBLIN_DEFAULT_NAME || name === CS2_DEFAULT_NAME || name === HS_DEFAULT_NAME;
}
