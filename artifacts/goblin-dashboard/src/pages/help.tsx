import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  BookOpen, LayoutDashboard, Gift, BarChart3, Settings2, Send, User, Coins, Sparkles,
  ChevronRight, Swords, Package, Zap, Trophy, ShieldCheck, HeartHandshake,
} from "lucide-react";

/* ─── Quick-start steps ─── */

const QUICK_START = [
  { step: 1, title: "Create your account", body: "Sign up at goblinl00t.com. The bot works out of the box on the Free tier — no credit card needed." },
  { step: 2, title: "Link your Twitch channel", body: "Go to Account → Channel tab and click Authorize on Twitch. The bot joins your chat within seconds of authorization." },
  { step: 3, title: "Pick a theme", body: "Head to Forge → Theme. Choose Goblin (fantasy) or CS2 (gaming). This swaps the loot pool, bot quips, and chat command aliases." },
  { step: 4, title: "Tell your viewers", body: "Let your chat know they can type !loot to roll for drops and !coins to check their balance. That's all they need to get started." },
  { step: 5, title: "Run your first giveaway", body: "Open Loot Horde, fill out the form, and click Start. Viewers enter with !enter. End it with the Elimination Wheel when you're ready to pick a winner." },
];

/* ─── Feature sections ─── */

interface Section {
  icon: React.ReactNode;
  title: string;
  description: string;
  bullets: { title: string; body: string }[];
}

const SECTIONS: Section[] = [
  {
    icon: <LayoutDashboard className="w-5 h-5 text-primary" />,
    title: "Dashboard",
    description: "Your live HQ. Everything happening in your stream, at a glance.",
    bullets: [
      { title: "Bot status", body: "Shows whether the bot is online, how long it's been running, and when it last posted in chat. If it's offline, check that your Twitch channel is linked in Account → Channel." },
      { title: "Live loot feed", body: "Every drop, redemption, buff activation, and goblin event scrolls here in real time. Great for keeping on screen during a stream." },
      { title: "Recent winners", body: "The last few giveaway winners with prize details. Scoped to your current stream window." },
      { title: "Onboarding checklist", body: "Appears until you complete the core setup steps: link Twitch, pick a theme, run your first giveaway. Dismissible once done." },
      { title: "Chat Users tab", body: "Every viewer who has ever earned coins or picked up an item. Search by name, adjust coin balances manually, and see full inventory." },
    ],
  },
  {
    icon: <Gift className="w-5 h-5 text-green-400" />,
    title: "Loot Horde (giveaways)",
    description: "Create giveaways, drop instant prizes, and spin the Elimination Wheel.",
    bullets: [
      { title: "Three prize types", body: "🔫 CS2 Skin — you deliver manually via Steam trade. 👺 Goblin Horde — a random item is rolled into the winner's pouch automatically. 🪙 Coins — credited directly to the winner's balance." },
      { title: "Combo prizes", body: "Add a coin bonus on top of any CS2 or Goblin Horde prize. The winner gets the item AND the coins." },
      { title: "Ticket cost", body: "Set how many coins it costs to enter. Viewers use !enter to spend coins and buy tickets. More tickets = better odds (unless Wheel Mode is on)." },
      { title: "Quick Prize Drop", body: "Need to reward someone instantly? Use Quick Prize Drop to push coins or a random item to any viewer without creating a full giveaway." },
      { title: "Giveaway presets", body: "Save your most-used giveaway configs as presets so you can spin one up with a single click next stream." },
      { title: "Elimination Wheel", body: "The wheel animates entries down one by one until a winner remains. A pixel-sprite battle settles the final two. Speed and mode (auto/manual) are set in Forge." },
      { title: "Restart a giveaway", body: "Ended a giveaway by mistake or want to re-run it? Open the giveaway detail and hit Restart — all existing entries are preserved." },
    ],
  },
  {
    icon: <Zap className="w-5 h-5 text-yellow-400" />,
    title: "Economy & Loot Drops",
    description: "How viewers earn and spend their coins.",
    bullets: [
      { title: "!loot drops", body: "Viewers type !loot and receive a random item or coin reward. Item rarity ranges from Common to Legendary. Items land in a 5-slot pouch. A full pouch automatically converts the drop to coins." },
      { title: "Buff items", body: "Lucky Charm (doubles loot luck on next !loot), Coin Pouch (doubles sell value), Ticket Charm (!enter adds an extra ticket). Activated with !use <slot>." },
      { title: "Random Goblin Events", body: "The bot fires random coin drops and steal events automatically when viewers are active in chat. Toggle in Forge → Economy & Loot." },
      { title: "Coin cap", body: "Set a ceiling so balances don't grow unbounded. Coins still earn normally but !coins and the leaderboard clip to the cap. Set in Forge → Economy & Loot." },
      { title: "Coin redemption", body: "Allow viewers to exchange coins for giveaway entries with !redeem. Toggle on/off per stream." },
      { title: "Coin adjustments", body: "Manually add or remove coins from any viewer via Dashboard → Chat Users → Adjust Coins. Great for raid rewards or punishments." },
    ],
  },
  {
    icon: <Package className="w-5 h-5 text-purple-400" />,
    title: "Inventory system",
    description: "Every viewer has a 5-slot pouch for loot and buff items.",
    bullets: [
      { title: "Viewing inventory", body: "Viewers type !inventory to see their current pouch in chat. You can also look anyone up in Dashboard → Chat Users." },
      { title: "Selling items", body: "!sell <slot> sells a single item for its coin value. !sell all clears the whole pouch. Having the Coin Pouch buff active doubles payout." },
      { title: "Full pouch", body: "If all 5 slots are taken when a drop happens, the item automatically converts to coins instead of bouncing entirely." },
      { title: "Buff activation", body: "!use <slot> activates the item in that slot. Luck and coin buffs are consumed on the next relevant event. Ticket buffs are consumed when the next !enter is placed." },
    ],
  },
  {
    icon: <BarChart3 className="w-5 h-5 text-primary" />,
    title: "Ledger (stats)",
    description: "Leaderboards, usage charts, and CSV exports.",
    bullets: [
      { title: "Time ranges", body: "Filter by Day, Week, Month, Year, or All Time. Stats are always scoped to your channel." },
      { title: "Coin leaderboard", body: "Top viewers by balance with rarity breakdown bars showing the makeup of each pouch." },
      { title: "Command usage chart", body: "See which !commands your viewers use most. Use this to decide which to enable or disable." },
      { title: "CSV export", body: "Download raw data for any range as a spreadsheet. Covers loot drops, command logs, and giveaway entries." },
      { title: "AI advisor", body: "Pro tier — the Goblin Advisor reads your stats and gives engagement and monetization suggestions powered by GPT." },
    ],
  },
  {
    icon: <Swords className="w-5 h-5 text-primary" />,
    title: "Spells (commands)",
    description: "Enable, disable, and customize every bot command.",
    bullets: [
      { title: "Toggle commands", body: "Flip any built-in command on or off. Disabled commands are silently ignored by the bot — no error in chat." },
      { title: "Live cooldowns", body: "See how many seconds remain before each command can be used again, updated in real time." },
      { title: "Custom responses", body: "Commands marked as customizable let you write your own response template. Use tokens: {user} (viewer name), {balance} (their coins), {commands} (list of enabled commands), {theme} (current theme name)." },
      { title: "CS2 aliases", body: "In CS2 theme, some commands get alternate names automatically: !goblin becomes !skin, !steal becomes !scam, !hoard becomes !stash, !feedgoblin becomes !case." },
    ],
  },
  {
    icon: <Settings2 className="w-5 h-5 text-primary" />,
    title: "Forge (settings)",
    description: "Central control for the bot, economy, theme, and integrations.",
    bullets: [
      { title: "General tab", body: "Set your bot display name, toggle Random Goblin Events / Special-Item Drops / Coin Redemption, set the coin cap, configure the Discord webhook for winner announcements, and set Elimination Wheel speed and mode." },
      { title: "Theme tab", body: "Switch between Goblin and CS2 theme. Changing theme instantly swaps the loot table, bot quips, and command aliases — no restart needed." },
      { title: "Discord webhook", body: "Paste a Discord channel webhook URL and the bot will post a winner embed whenever a giveaway ends. Host must be discord.com or discordapp.com." },
      { title: "Steam connection", body: "Required for CS2 prize delivery. Connect your Steam account and the bot will look up your CS2 inventory for skin giveaways." },
    ],
  },
  {
    icon: <Send className="w-5 h-5 text-primary" />,
    title: "Trade Office",
    description: "Track CS2 skin delivery from giveaway wins.",
    bullets: [
      { title: "How it works", body: "When a viewer wins a CS2 skin giveaway, they give the bot their Steam trade URL via !tradeurl <link>. It appears automatically in the Trade Office." },
      { title: "Delivery workflow", body: "Each trade item is listed as Pending. Mark it Locked while the trade is processing, then Sent once done. Add notes for reference." },
      { title: "Finding trade URLs", body: "Winners can get their trade URL from Steam → Inventory → Trade Offers → Who can send me Trade Offers? → Create Trade URL." },
    ],
  },
  {
    icon: <User className="w-5 h-5 text-primary" />,
    title: "Account",
    description: "Identity, channel binding, and subscription.",
    bullets: [
      { title: "Identity tab", body: "Update your email, set or change your password. Changes go through Clerk's secure flow." },
      { title: "Channel tab", body: "Connect or disconnect your Twitch account. Once linked, the bot joins your channel automatically." },
      { title: "Rank tab", body: "View your current tier (Free, Premium, Pro) and upgrade or manage your subscription." },
    ],
  },
  {
    icon: <Trophy className="w-5 h-5 text-amber-400" />,
    title: "Subscription tiers",
    description: "What's included at each plan level.",
    bullets: [
      { title: "Free — Cave Dweller", body: "Bot in chat, loot drops, giveaways, basic stats, coin economy, inventory system. All core features." },
      { title: "Premium — Horde Master", body: "Everything in Free plus Discord webhook for winner announcements, giveaway presets, and CSV export." },
      { title: "Pro — Goblin King", body: "Everything in Premium plus the AI Goblin Advisor on the Ledger page and priority support." },
    ],
  },
  {
    icon: <ShieldCheck className="w-5 h-5 text-muted-foreground" />,
    title: "Multi-channel & privacy",
    description: "How tenancy works when multiple streamers use the bot.",
    bullets: [
      { title: "Channel isolation", body: "Each streamer's coins, giveaways, inventory, and stats are completely separate. A viewer's coins earned in channel A cannot be spent in channel B." },
      { title: "Your data", body: "You can delete your account at any time from Account → Danger Zone. Deletion cancels active subscriptions, removes your Clerk identity, and purges all your channel data." },
      { title: "Viewer data", body: "Coin balances and inventory are stored against Twitch usernames, not personal accounts. Viewers have no dashboard login." },
    ],
  },
];

/* ─── Chat commands ─── */

interface CommandRow {
  command: string;
  description: string;
  alias?: string;
}

const COMMANDS: CommandRow[] = [
  { command: "!loot",             description: "Roll for a random loot drop. Bumped by the luck buff if active." },
  { command: "!inventory",        description: "Show your current 5-slot pouch in chat." },
  { command: "!sell <slot|all>",  description: "Sell one item or your whole pouch for coins. Coin Pouch buff doubles payout." },
  { command: "!use <slot>",       description: "Activate a buff item. Luck and coin buffs are single-use." },
  { command: "!coins",            description: "Show your coin balance.", alias: "!points" },
  { command: "!hoard",            description: "Show your coin balance with goblin flavor text.", alias: "!stash (CS2)" },
  { command: "!enter",            description: "Spend coins to enter the active giveaway. Ticket Charm adds a bonus entry." },
  { command: "!giveaway",         description: "Show the active giveaway title and keyword." },
  { command: "!redeem",           description: "Convert coins into giveaway entries (requires Coin Redemption to be enabled in Forge)." },
  { command: "!tradeurl <link>",  description: "Save your Steam trade URL so the streamer can deliver CS2 prizes." },
  { command: "!goblin",           description: "Random goblin taunt or flavor text.", alias: "!skin (CS2)" },
  { command: "!steal",            description: "Attempt to steal coins from another viewer.", alias: "!scam (CS2)" },
  { command: "!feedgoblin",       description: "Feed the goblin / open a case (themed flavor).", alias: "!case (CS2)" },
  { command: "!help",             description: "Lists all enabled commands for this channel." },
];

/* ─── FAQ ─── */

const FAQ = [
  { q: "The bot isn't posting in my chat — what's wrong?", a: "First check that your Twitch channel is linked in Account → Channel. Then look at the Dashboard bot status indicator. If it shows offline, the bot may not have a valid OAuth token — submit a support ticket above." },
  { q: "A viewer's coins are wrong — can I fix it?", a: "Yes. Go to Dashboard → Chat Users, find the viewer, and use Adjust Coins. You can add or subtract any amount. The change is immediate." },
  { q: "What happens when a viewer's inventory is full and they !loot?", a: "If all 5 slots are occupied, the loot drop automatically converts to a coin credit instead. The viewer still gets rewarded — they just don't get the item." },
  { q: "Do CS2 trade URLs expire?", a: "Steam trade URLs can be revoked by the viewer or expire if they change Steam settings. If a trade fails, ask the winner to share a fresh URL via !tradeurl." },
  { q: "Can I run multiple giveaways at the same time?", a: "Only one giveaway can be active at a time per channel. Start the next one after ending the current one." },
  { q: "How do I change the bot's language/style?", a: "Switch themes in Forge → Theme. For individual commands, use the custom response editor in Spells — you can write your own chat replies using tokens like {user} and {balance}." },
  { q: "Can viewers on my channel spend coins they earned on another channel?", a: "No. Coins are strictly per-channel. A viewer's balance in your chat is entirely separate from any other streamer using Goblin L00t." },
];

/* ─── Page ─── */

export function HelpGuide() {
  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Help &amp; Guide</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">Everything you need to set up, run, and get the most out of Goblin L00t.</p>
      </div>

      {/* Quick start */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Quick Start</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Up and running in five steps.</p>
        </div>
        <div className="space-y-3">
          {QUICK_START.map((step) => (
            <div key={step.step} className="flex gap-4 items-start p-4 rounded-lg border border-border/40 bg-muted/10">
              <div className="shrink-0 w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-sm font-bold text-primary">
                {step.step}
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature guide */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Feature Guide</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Deep dives into every part of the dashboard.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {SECTIONS.map((s) => (
            <Card key={s.title} className="border-border/50">
              <CardHeader className="border-b border-border/50 pb-3">
                <CardTitle className="flex items-center gap-2 font-medieval text-lg">
                  {s.icon}
                  {s.title}
                </CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                <ul className="space-y-3.5">
                  {s.bullets.map((b) => (
                    <li key={b.title} className="space-y-0.5">
                      <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                        {b.title}
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed pl-5">{b.body}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Commands table */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Chat Commands</h2>
          <p className="text-sm text-muted-foreground mt-0.5">The full spellbook your viewers can cast. Enable or disable any of these in Spells.</p>
        </div>
        <Card className="border-border/50">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-5 py-3 font-semibold">Command</th>
                  <th className="px-5 py-3 font-semibold">What it does</th>
                  <th className="px-5 py-3 font-semibold hidden sm:table-cell">Alias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {COMMANDS.map((c) => (
                  <tr key={c.command} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-mono text-primary text-xs whitespace-nowrap">{c.command}</td>
                    <td className="px-5 py-3 text-muted-foreground leading-relaxed">{c.description}</td>
                    <td className="px-5 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                      {c.alias ? <Badge variant="outline" className="font-mono text-[10px]">{c.alias}</Badge> : <span className="text-border">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* FAQ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Frequently Asked Questions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Common questions from streamers.</p>
        </div>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="p-4 rounded-lg border border-border/40 bg-muted/10 space-y-1.5">
              <p className="text-sm font-semibold text-foreground flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                {item.q}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed pl-5">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer callout */}
      <div className="flex items-center gap-4 p-5 rounded-lg border border-primary/20 bg-primary/5">
        <HeartHandshake className="w-6 h-6 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm">Still stuck?</p>
          <p className="text-xs text-muted-foreground">
            Open a support ticket and we'll get back to you directly by email.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/support">Contact Support</a>
        </Button>
      </div>

    </div>
  );
}

export default HelpGuide;
