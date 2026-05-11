/**
 * RPG-flavored elimination lines for the EliminationWheel modal.
 *
 * Each entry is a short, theme-flavored "death" message used as visual
 * eye-candy when an entry is knocked out. {user} is replaced with the
 * eliminated viewer's @handle. Purely cosmetic — these never reach Twitch
 * chat. Keep lines short (≤ ~80 chars) so the banner stays readable on
 * narrow viewports.
 */
const ELIMINATION_FLAVORS = [
  "🪓 {user} was struck down by a goblin's rusted club!",
  "💀 {user} stumbled into a mimic and got chewed up.",
  "🔥 {user} was incinerated by dragon's breath.",
  "❄️ {user} froze solid in a sudden blizzard.",
  "⚡ {user} miscast Lightning Bolt and zapped themselves.",
  "🕳️ {user} fell into a pit trap. Classic.",
  "🐉 {user} tried to pet the dragon. Tragic.",
  "🗡️ {user} got backstabbed by their own party member.",
  "🧪 {user} drank the wrong potion. RIP.",
  "👻 {user} was haunted off the wheel by an angry ghost.",
  "🪦 {user} rolled a natural 1 on their saving throw.",
  "🦴 {user} was crit by a skeleton archer.",
  "🍄 {user} ate a suspicious mushroom and dissolved.",
  "🌪️ {user} was swept away by a tornado of bats.",
  "🦇 {user} was drained dry by a vampire bat swarm.",
  "🧟 {user} was overwhelmed by the zombie horde.",
  "🐍 {user} was bitten by a basilisk. Petrified.",
  "🪤 {user} triggered an arrow trap. Pin cushion'd.",
  "🌋 {user} fell into a lava pit. Spicy.",
  "👹 {user} was eaten by the goblin king himself!",
  "🪄 {user}'s spell backfired. Self-banished.",
  "🛡️ {user} forgot to equip armor. Big mistake.",
  "🐺 {user} was ambushed by dire wolves.",
  "🏹 {user} took an arrow to the knee. (And the head.)",
  "💨 {user} was poisoned by goblin gas. Yikes.",
  "🌫️ {user} wandered into the mist and never returned.",
  "🦂 {user} was pinched into oblivion by giant scorpions.",
  "🪨 {user} was crushed by a falling boulder. Splat.",
  "🧊 {user} slipped on ice and shattered. Fragile.",
  "🐙 {user} was tentacled into the abyss.",
  "🪙 {user} tripped over their own loot pile. Embarrassing.",
  "🎲 {user} rolled a 1 on the loot table. The wheel ate them.",
] as const;

/**
 * Pick a random flavor line and substitute the user's name.
 * Returns plain text — the modal renders it as-is, no markdown parsing.
 */
export function pickEliminationFlavor(username: string): string {
  const line = ELIMINATION_FLAVORS[Math.floor(Math.random() * ELIMINATION_FLAVORS.length)]!;
  return line.replace(/\{user\}/g, `@${username}`);
}

/**
 * Final-two "showdown" line — used right before the final spin.
 */
export function pickFinalTwoFlavor(usernames: [string, string]): string {
  const [a, b] = usernames;
  const lines = [
    `⚔️ Final showdown: @${a} vs @${b}!`,
    `🎲 Two warriors remain: @${a} and @${b}. One must fall.`,
    `🔥 The arena trembles. @${a} squares off against @${b}.`,
    `👑 Only one crown. @${a} or @${b} — who claims it?`,
  ];
  return lines[Math.floor(Math.random() * lines.length)]!;
}

/**
 * Winner reveal flair — shown on the crown banner.
 */
export function pickVictoryFlavor(username: string): string {
  const lines = [
    `👑 @${username} stands victorious atop the goblin's horde!`,
    `🏆 The wheel has spoken: @${username} wins it all!`,
    `🎉 @${username} survived the carnage and claims the prize!`,
    `⚜️ Hail @${username} — champion of the horde!`,
    `🌟 @${username} rolled a natural 20 on destiny.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)]!;
}
