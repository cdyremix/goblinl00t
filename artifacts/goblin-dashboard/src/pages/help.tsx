import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, LayoutDashboard, Gift, BarChart3, Settings2, Send, User, Coins, Sparkles, MessageSquare, Tv, Users2,
} from "lucide-react";

interface Section {
  icon: React.ReactNode;
  title: string;
  description: string;
  bullets: { title: string; body: string }[];
}

const SECTIONS: Section[] = [
  {
    icon: <Tv className="w-5 h-5 text-purple-400" />,
    title: "Getting started",
    description: "Get the goblin into your chat in two clicks.",
    bullets: [
      { title: "Bind your Twitch channel", body: "Open Account Settings → Channel Binding and click Authorize on Twitch. The bot joins your chat as soon as it's bound." },
      { title: "Pick a theme", body: "Forge → Bot display name + theme picker. Goblin (default) or CS2 — labels and bot quips swap automatically." },
      { title: "Tweak the economy", body: "Forge → Economy & Loot. Toggle random goblin events, special-item drops, coin redemption, and the coin balance cap." },
    ],
  },
  {
    icon: <LayoutDashboard className="w-5 h-5 text-primary" />,
    title: "Operations",
    description: "Your live HQ for the stream.",
    bullets: [
      { title: "Bot status", body: "Online/offline indicator, uptime, and last activity. If offline, check that the Twitch token is set in env vars." },
      { title: "Live loot feed", body: "Every drop, redemption, and goblin event scrolls here in real time." },
      { title: "Chat Users", body: "See every viewer with a coin balance or inventory. Adjust coins (+/-) for shoutouts, raids, or punishments." },
    ],
  },
  {
    icon: <Gift className="w-5 h-5 text-primary" />,
    title: "Loot Hoard (giveaways)",
    description: "Forge giveaways and hand out Quick Prizes.",
    bullets: [
      { title: "Three prize sources", body: "🔫 CS2 Skin (manual delivery via Trade Office), 👺 Goblin Hoard (random item rolled into winner's pouch), 🪙 Coins (credited directly)." },
      { title: "Bonus coins", body: "Add a coin amount to a CS2 or Goblin Hoard prize and the winner gets both." },
      { title: "Quick Prize", body: "Drop coins or a random item to any viewer instantly without making a giveaway." },
      { title: "Elimination Wheel", body: "When ending a giveaway, the wheel animates eliminations until the winner remains. Speed and manual/auto mode in Forge." },
    ],
  },
  {
    icon: <BarChart3 className="w-5 h-5 text-primary" />,
    title: "Ledger",
    description: "Top looters and command usage.",
    bullets: [
      { title: "Leaderboard", body: "Sorted by coin balance with rarity bars showing pouch composition." },
      { title: "Command chart", body: "See which !commands viewers use most. Disable noisy ones from Forge → Spells." },
    ],
  },
  {
    icon: <Settings2 className="w-5 h-5 text-primary" />,
    title: "Forge (settings)",
    description: "Bot, commands, theme, economy.",
    bullets: [
      { title: "Spells (commands)", body: "Toggle individual !commands on/off. Cooldowns shown live." },
      { title: "Theme", body: "Goblin or CS2 — swaps loot pool, bot quips, and chat command aliases." },
      { title: "Economy & Loot", body: "Random Goblin Events, Special-Item Drops, Coin Redemption, and Coin Cap (display ceiling for !coins / leaderboard)." },
      { title: "Elimination Wheel mode/speed", body: "auto vs manual; slow / medium / fast pacing." },
      { title: "Steam connection", body: "Trade URL + Steam ID 64. Required for picking CS2 skins as prizes." },
    ],
  },
  {
    icon: <Send className="w-5 h-5 text-primary" />,
    title: "Trade Office",
    description: "Track CS2 skin delivery to winners.",
    bullets: [
      { title: "Pending → sent", body: "Mark trade-locked items, paste notes, update status when the trade goes through." },
      { title: "Winner trade URLs", body: "Winners give the bot their trade URL with !tradeurl <link>. It saves automatically." },
    ],
  },
  {
    icon: <User className="w-5 h-5 text-primary" />,
    title: "Account Settings",
    description: "Your hoard membership and channel binding.",
    bullets: [
      { title: "Identity", body: "Avatar, email, password. Email/password use Clerk's secure flow." },
      { title: "Channel Binding", body: "Connect or banish your Twitch channel." },
      { title: "Rank", body: "Cave Dweller (free), Hoard Master, Goblin King — billing coming soon." },
    ],
  },
];

interface CommandRow {
  command: string;
  description: string;
  alias?: string;
}

const COMMANDS: CommandRow[] = [
  { command: "!loot", description: "Roll for a random loot drop. Bumped by the luck buff." },
  { command: "!enter", description: "Spend coins to enter the active giveaway. Configurable cost per ticket." },
  { command: "!inventory", description: "Show your 5-slot pouch." },
  { command: "!sell <slot|all>", description: "Sell items for coins. Coins-buff doubles the payout." },
  { command: "!use <slot>", description: "Activate a buff item (luck, coins, ticket)." },
  { command: "!coins", description: "Show your coin balance.", alias: "!points" },
  { command: "!giveaway", description: "Show the active giveaway and its keyword." },
  { command: "!redeem", description: "Convert your coins into giveaway tickets (gated by the redemption toggle)." },
  { command: "!tradeurl <link>", description: "Save your Steam trade URL so the streamer can deliver CS2 prizes." },
  { command: "!goblin", description: "Random goblin taunt.", alias: "!skin (CS2)" },
  { command: "!steal", description: "Try to mug another viewer for coins.", alias: "!scam (CS2)" },
  { command: "!hoard", description: "Show your coin balance with flavor.", alias: "!stash (CS2)" },
  { command: "!feedgoblin", description: "Feed the goblin / open a case (themed flavor).", alias: "!case (CS2)" },
];

export function HelpGuide() {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <div className="flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Help &amp; Guide</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">Everything the goblin can do, in one scroll.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {SECTIONS.map((s) => (
          <Card key={s.title} className="border-border/50">
            <CardHeader className="border-b border-border/50">
              <CardTitle className="flex items-center gap-2 font-medieval text-lg">
                {s.icon}
                {s.title}
              </CardTitle>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <ul className="space-y-4">
                {s.bullets.map((b) => (
                  <li key={b.title} className="space-y-1">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-primary" />
                      {b.title}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{b.body}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2 font-medieval text-lg">
            <MessageSquare className="w-5 h-5 text-primary" />
            Chat Commands
          </CardTitle>
          <CardDescription>The full spellbook your viewers can cast in chat.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-6 py-3 font-semibold">Command</th>
                <th className="px-6 py-3 font-semibold">What it does</th>
                <th className="px-6 py-3 font-semibold">Alias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {COMMANDS.map((c) => (
                <tr key={c.command} className="hover:bg-muted/20 transition-colors">
                  <td className="px-6 py-3 font-mono text-primary text-xs whitespace-nowrap">{c.command}</td>
                  <td className="px-6 py-3 text-foreground">{c.description}</td>
                  <td className="px-6 py-3 text-muted-foreground text-xs">
                    {c.alias ? <Badge variant="outline" className="font-mono">{c.alias}</Badge> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-primary/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Coins className="w-6 h-6 text-primary shrink-0 mt-1" />
            <div className="space-y-2">
              <p className="font-semibold text-foreground">A note on coin balance</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Coin balance = total earned (from <code className="text-primary font-mono">loot_drops</code>) minus total redeemed
                (from <code className="text-primary font-mono">point_redemptions</code>). The Forge's Coin Cap is a display
                clip — earnings always write through, but <code className="text-primary font-mono">!coins</code>, the leaderboard,
                and redemption checks honor the ceiling.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default HelpGuide;
