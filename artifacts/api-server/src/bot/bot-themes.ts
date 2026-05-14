import {
  LOOT_RESPONSES,
  ENTER_RESPONSES,
  GIVEAWAY_START,
  GIVEAWAY_END,
  STEAL_RESPONSES,
  GOBLIN_GREETINGS,
} from "./goblin-phrases";

export type BotTheme = "goblin" | "cs2" | "hearthstone";

export interface ThemeMeta {
  id: BotTheme;
  name: string;
  tagline: string;
  emoji: string;
  previewLines: string[];
}

export interface ThemePhrases {
  lootResponses: {
    common: string[];
    uncommon: string[];
    rare: string[];
    epic: string[];
    legendary: string[];
  };
  lootMiss: string[];
  enterResponses: string[];
  giveawayStart: string[];
  giveawayEnd: string[];
  stealResponses: string[];
  goblinResponses: string[];
  feedResponses: string[];
  giveawayNone: string;
  enterAlreadyIn: (username: string) => string;
  enterNoGiveaway: (username: string) => string;
  hoardEmpty: (username: string) => string;
  hoardFull: (username: string, count: number, totalPts: number) => string;
  stealNoTarget: string;
}

export const THEME_META: Record<BotTheme, ThemeMeta> = {
  goblin: {
    id: "goblin",
    name: "Goblin Hoard",
    tagline: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
    emoji: "👺",
    previewLines: [
      "HEHEHE! @xXSniper rolls [RARE] Dragon Scale! (+120 pts) SCREEE!! goblin want to STEAL!!",
      "🎉 GIVEAWAY TIME!!!! Prize: Mystery Box - Type !enter!! HEHEHE goblin running GIVEAWAY!!",
      "*goblin checks ledger* ChatUser haz 12 loot itemz worth 340 pts total! Keep farming!! 📦",
    ],
  },
  cs2: {
    id: "cs2",
    name: "CS2 Arms Deal",
    tagline: "Counter-Strike 2 mode — drop skins, run skin giveaways, and collect Steam trade links.",
    emoji: "🔫",
    previewLines: [
      "🟣 xXSniper opened a case: [CLASSIFIED] Butterfly Knife | Fade! (+800 pts) INSANE DROP! chat going crazy rn",
      "🎁 SKIN GIVEAWAY! We're dropping: AK-47 | Asiimov FN — type !enter to be in the draw!",
      "📦 xXSniper's inventory: 8 skins | 1,240 pts. Nice haul, still no knife tho PepeHands",
    ],
  },
  hearthstone: {
    id: "hearthstone",
    name: "Hearthstone Tavern",
    tagline: "Tavern Brawl mode — crack packs, roll legendaries, and let RNGsus decide your fate.",
    emoji: "🍺",
    previewLines: [
      "🌟 LEGENDARY!! xXSniper cracked a pack: Ragnaros the Firelord! (+500 pts) THE TAVERN IS IN UPROAR!!",
      "📣 TAVERN BRAWL! Prize: Epic Card Pack Bundle — type !enter to compete! RNGsus decides all!",
      "📦 xXSniper's collection: 8 cards | 1,240 pts worth of dust. Keep opening packs, you'll get there.",
    ],
  },
};

const GOBLIN_THEME: ThemePhrases = {
  lootResponses: LOOT_RESPONSES,
  lootMiss: [
    "pffff {user} went rummaging and found NOTHING!! Heheheh!!",
    "HAHAHAHA!! {user} dug through da hoard and came up empty-handed!!",
    "nope nope nope!! Da goblin hid all da loot before {user} arrived!! Hehehe!!",
    "🕳️ {user} dug a hole and found... dirt. Classic goblin tricks.",
    "SCREEE!! Goblin already TOOK everything before {user} showed up!!",
  ],
  enterResponses: ENTER_RESPONSES,
  giveawayStart: GIVEAWAY_START,
  giveawayEnd: GIVEAWAY_END,
  stealResponses: STEAL_RESPONSES,
  goblinResponses: [
    "HEHEHE! *goblin dances* I AM DA MOST POWERFUL GOBLIN IN DIS STREAM!! >:D",
    "SCREEEEE!! What you want?! Goblin busy counting hoard!! 💎",
    "*suspicious goblin eyes* Why you summon goblin?? Goblin watching... ALWAYS watching... 👀",
    "Oh it's YOU. *goblin grumbles* fine fine, goblin here. what you want. 😤",
  ],
  feedResponses: [
    "🍖 Goblin eatz the offering!",
    "🍕 YUMMY!! Goblin happy now!",
    "🍪 Oooh cookiez!! Goblin blessed!!",
  ],
  giveawayNone: "HEHEHE no giveaway right now! Ask da streamer to start one! 🤷",
  enterAlreadyIn: (u) => `HEHEHE ${u} you iz already in da drawing! No sneaking extra entries!!`,
  enterNoGiveaway: (u) => `HEHEHE! No giveaway running right now ${u}! Wait for goblin to start one! 🤷`,
  hoardEmpty: (u) => `HEHEHE!! ${u} haz NOTHING!! Go use !loot to fill your hoard!!`,
  hoardFull: (u, count, pts) =>
    `*goblin checks ledger* ${u} haz ${count} loot item${count !== 1 ? "z" : ""} worth ${pts} pts total! Keep farming!! 📦`,
  stealNoTarget: "HEHEHE!! You gotta say WHO to steal from!! !steal @username",
};

const CS2_THEME: ThemePhrases = {
  lootMiss: [
    "💸 {user} opened a case — it was empty. Bot already looted it.",
    "❌ {user} missed the drop window. Float gods giveth, float gods taketh.",
    "🔒 RNG said no for {user}. The market is brutal today.",
    "💀 {user} checked the case and got a Factory New... disappointment.",
    "No drop for {user}. It's giving Consumer Grade odds out here.",
  ],
  lootResponses: {
    common: [
      "just a Consumer Grade sticker. No inspect animation for you. sadge",
      "Industrial Grade at best. Bot's not even trying today.",
      "graffiti. worth like 3 cents on the market. gg",
    ],
    uncommon: [
      "Mil-Spec skin! Not bad — floats well, sells decent. 💰",
      "Mil-Spec drop! chat we're cookin (a little)",
      "alright alright, Restricted skin! worth inspecting at least.",
    ],
    rare: [
      "🔵 RESTRICTED SKIN! Chat actually popping off rn",
      "Classified-tier pull! That's clean, no cap.",
      "Chat we got a RESTRICTED drop! Float check ASAP 👀",
    ],
    epic: [
      "🟣 CLASSIFIED SKIN!! Chat is NOT okay rn!!",
      "COVERT TIER!! That's worth actual money holy moly",
      "🔴 COVERT DROP! streamer jealous not gonna lie",
    ],
    legendary: [
      "🌟 RARE SPECIAL ITEM!! IS THAT A KNIFE?! CHAT LOSING IT!! 🌟",
      "⭐ StatTrak™ KNIFE DROP!! This is literally life-changing!! Call your mom!!",
      "GLOVES OR KNIFE?! EITHER WAY CHAT IS ACTUALLY INSANE RIGHT NOW 🔥🔥🔥",
    ],
  },
  enterResponses: [
    "{user} is entered! May RNG bless you with a Karambit 🙏",
    "{user} threw their name in the pool. Good luck — the odds are like opening a knife, but still.",
    "✅ {user} is in the draw! Float factory will determine your fate.",
    "Added {user} to the list. StatTrak™ entry confirmed.",
  ],
  giveawayStart: [
    "🎁 SKIN GIVEAWAY!! We're dropping: {prize} — type {keyword} to enter the draw! Good luck chat!",
    "🔫 FREE SKIN TIME!! Prize: {prize} | Use {keyword} to enter! RNG decide who eats tonight!",
    "Case opening but make it free — {prize} up for grabs! Type {keyword} NOW! Float gods be with you 🙏",
  ],
  giveawayEnd: [
    "🏆 The skin goes to... {winner}! Congrats on {prize}! Don't forget to send your trade link!",
    "🎉 {winner} takes home {prize} from {count} entries! Trade offer incoming — check your Steam!",
    "Float checked, RNG confirmed — {winner} wins {prize}! StatTrak™ W right there.",
  ],
  stealResponses: [
    "TRADE SCAM DETECTED: {target} did not accept the 7-day trade hold. Retreat!",
    "Tried to snag {target}'s knife but they had 2FA on. Classic.",
    "{target} saw the sus trade offer and cancelled. Can't fool a veteran.",
  ],
  goblinResponses: [
    "I'm the bot, I live here. This is my server now. Also buff AWP.",
    "CS2 economy is pain and I am merely a reflection of that pain. 🔫",
    "I've seen 1000 case openings and not a single knife. I have trust issues.",
    "MM rank: Supreme. Trust factor: RED. I'm built different. 💀",
  ],
  feedResponses: [
    "🥩 Feeding the bot a Prime account. Delicious.",
    "Ingested one (1) operation pass. Nutrition: debatable.",
    "🍔 Fed. Now run cache. — wait that map's not in the pool. Sad.",
  ],
  giveawayNone: "No skin giveaway active right now! Hang tight — streamer's probably opening cases.",
  enterAlreadyIn: (u) => `${u} you're already in the draw! One entry per person, no VAC bypass here.`,
  enterNoGiveaway: (u) => `${u} there's no active giveaway right now. Wait for the streamer to kick one off!`,
  hoardEmpty: (u) => `${u} has 0 skins. Pure vanilla. You're literally playing on default gloves and a knife you don't own.`,
  hoardFull: (u, count, pts) =>
    `📦 ${u}'s inventory: ${count} skin${count !== 1 ? "s" : ""} | ${pts} pts. ${pts > 500 ? "Getting spicy in that loadout 🔥" : "Keep rolling for that knife PepeHands"}`,
  stealNoTarget: "Who are you trying to scam? Use !steal @username to attempt a trade offer.",
};

const HS_THEME: ThemePhrases = {
  lootMiss: [
    "💨 {user} mulliganed their whole hand and got nothing back. Classic.",
    "🎴 {user} reached into the pack... and pulled out 40 dust. The Innkeeper weeps.",
    "RNGsus has forsaken {user}. No loot today, mortal.",
    "❌ {user} opened a pack: 5 commons, 3 duplicates. Disenchanted immediately.",
    "The Innkeeper checks the hoard... nothing for {user}. Maybe next tavern brawl. 🍺",
  ],
  lootResponses: {
    common: [
      "just a basic card. The Innkeeper has seen better.",
      "a duplicate common. Worth exactly 5 dust. Exciting.",
      "a common you already have 4 of. The collection grows... sideways.",
    ],
    uncommon: [
      "🟢 a Rare card! Now THAT'S worth inspecting. Well played!",
      "Nice Rare pull! The Innkeeper nods approvingly. 🍺",
      "A Rare! One Rare a day keeps the concede away.",
    ],
    rare: [
      "🔵 an EPIC card! Chat's getting noisy in the Tavern!",
      "EPIC PULL! The Innkeeper slams down a celebratory mug! 🍺",
      "Did someone say Epic?! Because that's exactly what just happened!",
    ],
    epic: [
      "🟣 A LEGENDARY!! THE TAVERN IS IN AN UPROAR!! 🎉",
      "LEGENDARY CARD!! Call it — it's a LEGENDARY!! The crowd goes wild!!",
      "⚡ THAT'S AMAZING! A Legendary drop in the Tavern! 🌟",
    ],
    legendary: [
      "✨ GOLDEN LEGENDARY!! The Innkeeper has NEVER seen anything like this!! chat is LOSING IT!!",
      "🌟 SIGNATURE LEGENDARY!! The pack opening gods have smiled upon this blessed soul!!",
      "GOLDEN FOIL SHIMMER!! This is the rarest of the rare!! The whole Tavern stopped!! 🔥",
    ],
  },
  enterResponses: [
    "{user} registers their name at the Innkeeper's desk! May RNGsus bless your draw!",
    "✅ {user} enters the Tavern Brawl! One entry per adventurer.",
    "{user} is in the pool! The Innkeeper will draw when the time is right. 🎴",
    "Added {user} to the guestbook! Well played for entering.",
  ],
  giveawayStart: [
    "📣 TAVERN BRAWL! This week's prize: {prize} — type {keyword} to enter! The Innkeeper opens the doors!",
    "🍺 FREE PACK OPENING! Prize: {prize} | Use {keyword} to enter! RNGsus decides all!",
    "HEAR YE! The Innkeeper announces a special giveaway: {prize}! Type {keyword} to compete in the Brawl!",
  ],
  giveawayEnd: [
    "🏆 The Innkeeper draws from the hat... {winner} wins {prize} from {count} entries! Well played!",
    "🎉 {winner} takes home {prize}! Congratulations from the Tavern! The crowd cheers! 🍺",
    "The dice have been rolled — {winner} is our champion! {prize} is theirs! WELL PLAYED!",
  ],
  stealResponses: [
    "{target} had the Innkeeper watching their hoard. Theft attempt failed.",
    "Your rogue action against {target} was countered. RNGsus was not on your side.",
    "{target} used Polymorph. You are now a sheep. No coins were stolen. 🐑",
  ],
  goblinResponses: [
    "🍺 Welcome to the Tavern! The Innkeeper at your service. Have you tried the brew?",
    "Ah, a challenger approaches! The Innkeeper has seen many adventurers fall... most of them in Arena.",
    "Well played! Now sit down, order a drink, and wait for the next Brawl. 🎴",
    "The Innkeeper sees all. The Innkeeper knows all. The Innkeeper also definitely hasn't been rigging packs.",
  ],
  feedResponses: [
    "🍖 The Innkeeper accepts this offering! Strength grows.",
    "🍺 Mmmm, a cold brew. The Innkeeper is pleased.",
    "🎴 Fed the Innkeeper a golden card. Delicious. Truly a 5-star meal.",
  ],
  giveawayNone: "No Brawl active right now! The Innkeeper is polishing mugs — ask your streamer to start one! 🍺",
  enterAlreadyIn: (u) => `${u} you're already at the table! No duplicate entries, the Innkeeper is watching.`,
  enterNoGiveaway: (u) => `${u} the Tavern Brawl hasn't started yet! Wait for the Innkeeper to ring the bell. 🔔`,
  hoardEmpty: (u) => `${u} has nothing in the collection — zero cards, zero dust. Hit !loot and start your journey, adventurer!`,
  hoardFull: (u, count, pts) =>
    `📦 ${u}'s collection: ${count} card${count !== 1 ? "s" : ""} | ${pts} pts worth of dust. ${pts > 500 ? "That's a solid haul! 🃏" : "Keep opening packs, you'll get there."}`,
  stealNoTarget: "Who are you trying to scam? Specify your target: !steal @username",
};

export const THEMES: Record<BotTheme, ThemePhrases> = {
  goblin: GOBLIN_THEME,
  cs2: CS2_THEME,
  hearthstone: HS_THEME,
};

let _activeTheme: BotTheme = "goblin";

export function getActiveTheme(): BotTheme {
  return _activeTheme;
}

export function setActiveTheme(theme: BotTheme): void {
  _activeTheme = theme;
}

export function getThemePhrases(): ThemePhrases {
  return THEMES[_activeTheme];
}
