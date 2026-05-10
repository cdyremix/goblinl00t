// Default bot display names per theme.
export const GOBLIN_DEFAULT_NAME = "Goblin L00t";
export const CS2_DEFAULT_NAME = "Number K";

export function defaultBotNameFor(theme: "goblin" | "cs2"): string {
  return theme === "cs2" ? CS2_DEFAULT_NAME : GOBLIN_DEFAULT_NAME;
}

// True if the given name is one of the built-in theme defaults (any theme).
export function isAnyThemeDefault(name: string): boolean {
  return name === GOBLIN_DEFAULT_NAME || name === CS2_DEFAULT_NAME;
}
