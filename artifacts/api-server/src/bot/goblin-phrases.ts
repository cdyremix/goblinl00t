export const GOBLIN_GREETINGS = [
  "HEHEHE! Da goblin iz HERE! >:D",
  "YOINK! Da goblin wakez up from hoard-napz!",
  "SCREEE! Goblin smell SHINYZ in dis channel!",
  "*sniffs air* mmm... smells like LOOT in here heheheh",
];

export const LOOT_RESPONSES = {
  common: [
    "heh... is ok loot i guezz *shrugs*",
    "pfff common stuff. goblin not impressd.",
    "boring!! but is YOURS heheheh",
  ],
  uncommon: [
    "ooooh not BAD! Goblin approve!",
    "hehe now THAT is decent loot!",
    "not bad not bad... goblin impressed!",
  ],
  rare: [
    "WAAAH!! DAT IZ GOOD LOOT!! *jealous goblin noises*",
    "SCREEE!! RARE STUFFZ!! goblin want to STEAL!!",
    "OH WOW!! You iz lucky chatter!!",
  ],
  epic: [
    "WAAAAAHHH!!! EPIC LOOT!!!! *goblin faints*",
    "NOOOO NOT FAIR!! Goblin want dat!! GIMME!!",
    "SCREEEEE!!!! DAT IZ INCREDIBLY SHINY!!!!",
  ],
  legendary: [
    "🌟🌟🌟 LEGENDARY!!!!! GOBLIN CANT BELIEVE IT!!!! WHOLE HOARD IS JEALOUS!!! 🌟🌟🌟",
    "YOOOOOOO!!!! LEGENDARY DROP!!!!! *goblin explodes from excitement*",
    "WHAAATTT!!!! DA CHAT HAS BEEN BLESSED BY DA GOBLIN GODZ!!!!! 🔱✨",
  ],
};

export const ENTER_RESPONSES = [
  "HEHEHE! {user} iz in da pool! *scribbles name on paper*",
  "OOH! {user} wantz da loot! Goblin writez it down!",
  "*drops {user}'s name in da hat* HEHEHE!",
  "Goblin seez {user}! You iz entered! GOOD LUCK HEHEHEH!",
];

export const GIVEAWAY_START = [
  "🎉 GIVEAWAY TIME!!!! Prize: {prize} - Type {keyword} to enter!! HEHEHE goblin running GIVEAWAY!!",
  "🎁 OOH SHINY GIVEAWAY!! Goblin giving away: {prize}!! Type {keyword} NOW!! SCREEE!!",
  "HEHEHE!! Goblin feel GENEROUS!! Giving away {prize}!! Type {keyword} to WIN!!",
];

export const GIVEAWAY_END = [
  "🎉 GIVEAWAY OVER!! Da winner iz... {winner}!! CONGRATZ!! Goblin did fair draw! (probably)",
  "SCREEE!! From {count} entries... {winner} WINS {prize}!! Goblin very excite!!",
  "🏆 AND DA LUCKY ONE IZ... {winner}!! YOU WIN {prize}!! hehehe goblin happy for u!",
];

export const STEAL_RESPONSES = [
  "YOINK!! Goblin tried to steal from {target} but dey fought back!! *runs away*",
  "HEHEHE *sneaks up on {target}*... wait dey saw me!! ABORT ABORT!!",
  "*goblin stealth -100* {target} caught goblin trying to steal! Embarrassing!!",
];

export const HOARD_RESPONSES = [
  "HEHEHE your hoard haz {count} itemz! Goblin iz JEALOUS!",
  "*counts on fingers* You got {count} loot itemz! Not bad for non-goblin!",
  "Goblin checkz book... {user} has {count} itemz in inventory! Keep farming!",
];

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (msg, [key, val]) => msg.replace(new RegExp(`\\{${key}\\}`, "g"), String(val)),
    template
  );
}
