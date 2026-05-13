function Entry({ version, date, children }: { version: string; date: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl font-bold text-foreground">{version}</h2>
        <span className="text-sm text-muted-foreground">{date}</span>
      </div>
      <div className="space-y-1.5 pl-4 border-l border-border">{children}</div>
    </div>
  );
}

function Item({ type, children }: { type: "new" | "fix" | "change" | "remove"; children: React.ReactNode }) {
  const colors = {
    new:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    fix:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
    change: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    remove: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const labels = { new: "New", fix: "Fix", change: "Changed", remove: "Removed" };
  return (
    <div className="flex items-start gap-2.5 py-1">
      <span className={`mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors[type]}`}>
        {labels[type]}
      </span>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

export default function Changelog() {
  return (
    <div className="max-w-2xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-primary">Changelog</h1>
        <p className="text-sm text-muted-foreground mt-1">What's new in Goblin L00t</p>
      </div>

      <Entry version="v1.0" date="May 2026">
        <Item type="new">Scheduled Announcements — add timed bot messages that auto-post to chat on a repeating interval. Managed from the Loot Horde page.</Item>
        <Item type="new">OBS browser-source overlay — live loot ticker at <code>/overlay/:channel</code>. Copy the link from the dashboard stream banner (Horde Master).</Item>
        <Item type="new">!top command — bot posts the top 5 coin holders for the channel in chat.</Item>
        <Item type="new">!gift command — viewers can transfer coins to each other (<code>!gift @username amount</code>), respecting per-channel coin caps.</Item>
        <Item type="new">Per-giveaway analytics — entry rate chart, ticket-source breakdown, and redemption vs manual counts on each giveaway detail page.</Item>
        <Item type="new">Viewer retention card on the Ledger — shows the percentage of active viewers who also participated the prior week.</Item>
        <Item type="new">Stream session timer — live uptime counter next to the ONLINE indicator on the dashboard.</Item>
        <Item type="change">Scheduled Announcements moved from Forge to Loot Horde, below the live giveaway card. Collapsible and closed by default.</Item>
        <Item type="change">Forge settings reorganised — Random Goblin Events grouped inside Economy &amp; Loot; Discord Webhook promoted to its own standalone section.</Item>
      </Entry>

      <Entry version="v0.9" date="May 2026">
        <Item type="new">Staff role — grants full bot/dashboard access and feature-gate bypass without admin panel access.</Item>
        <Item type="new">Goblin Advisor AI report on the Ledger page (pro tier) — engagement and monetization insights powered by GPT.</Item>
        <Item type="change">Forge settings consolidated — Giveaway tab merged into General so all economy &amp; loot settings are in one place.</Item>
        <Item type="fix">Sidebar now stays fixed-height and fully visible regardless of page content length.</Item>
        <Item type="fix">AI integration clients no longer crash the server on self-hosted deployments when OpenAI env vars are absent.</Item>
      </Entry>

      <Entry version="v0.8" date="April 2026">
        <Item type="new">Elimination Wheel — wheel-based giveaway drawing with pixel-fight finale and configurable speed/mode.</Item>
        <Item type="new">Giveaway presets — save and reuse giveaway configurations.</Item>
        <Item type="new">Quick Prize Drop — instantly drop a prize without creating a full giveaway.</Item>
        <Item type="new">CS2 skin giveaway support — Trade Office for managing skin delivery via Steam trade URLs.</Item>
        <Item type="new">Per-channel theme — Goblin and CS2 modes with distinct bot language and item tables.</Item>
        <Item type="change">Bot now supports multiple channels simultaneously without restart.</Item>
        <Item type="fix">Coin cap enforcement — per-channel coin ceiling now applied on all credit paths.</Item>
      </Entry>

      <Entry version="v0.7" date="March 2026">
        <Item type="new">Stripe subscription billing — Free, Premium, and Pro tiers with feature gating throughout the dashboard.</Item>
        <Item type="new">Admin Console — create and manage user accounts, billing, and maintenance mode.</Item>
        <Item type="new">Maintenance mode — lock the dashboard for public users while admins and staff keep working.</Item>
        <Item type="new">Chat Users page — view every viewer with coins or inventory, adjust balances manually.</Item>
        <Item type="new">Discord webhook — auto-post winner embeds when a giveaway ends.</Item>
        <Item type="change">Inventory expanded to 5 slots with per-user advisory locking.</Item>
      </Entry>

      <Entry version="v0.6" date="February 2026">
        <Item type="new">Loot Horde (Giveaway) — start, spin, and end giveaways with live entry tracking.</Item>
        <Item type="new">Ledger — Day/Week/Month/Year/All stats with CSV export.</Item>
        <Item type="new">Spells page — toggle and configure bot commands with live cooldown display.</Item>
        <Item type="new">Random Goblin Events — scheduled random coin drops and steals in chat.</Item>
        <Item type="new">Buff items (Lucky Charm, Goblin Blessing, etc.) rolling from !loot.</Item>
      </Entry>

      <Entry version="v0.5" date="January 2026">
        <Item type="new">Initial release — Twitch bot with !loot, !enter, !inventory, !sell, !redeem, !points commands.</Item>
        <Item type="new">Dashboard with bot status, recent winners, and live loot feed.</Item>
        <Item type="new">Clerk authentication with Twitch account linking.</Item>
      </Entry>
    </div>
  );
}
