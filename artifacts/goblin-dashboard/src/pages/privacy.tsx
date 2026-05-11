export default function Privacy() {
  return (
    <div className="prose prose-invert max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-4xl font-bold tracking-tight text-primary">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: May 2026</p>

      <Section title="What we collect">
        <ul className="list-disc pl-5 space-y-1">
          <li>Your Clerk account identifier and email (so you can sign in).</li>
          <li>Your Twitch username, user ID, and OAuth tokens (so the bot can join your channel).</li>
          <li>Your Steam ID and trade URL when you connect Steam (for CS2 giveaway delivery).</li>
          <li>Chat command activity, loot drops, giveaway entries, and inventory state for streamers who use those features.</li>
          <li>Optional Discord webhook URL you configure for end-of-giveaway notifications.</li>
        </ul>
      </Section>

      <Section title="How we use it">
        We use this data to operate the Service: running the bot, drawing
        giveaways, showing your dashboard, and sending the Discord notifications
        you configure. We do not sell your data.
      </Section>

      <Section title="Where it lives">
        Data is stored in a managed PostgreSQL database hosted on Replit. OAuth
        tokens are stored encrypted at rest. Clerk handles your authentication
        session.
      </Section>

      <Section title="Third parties">
        We share data with Twitch (to interact with their API on your behalf),
        Steam (when you initiate a Steam connection), Clerk (for authentication),
        and Discord (only when you configure a webhook URL — and only the winner
        announcement payload).
      </Section>

      <Section title="Viewer data">
        Chat usernames, redemption history, and inventory contents for viewers
        in your channel are stored to make the bot work. We don't expose this
        data to other streamers or to the public web.
      </Section>

      <Section title="Cookies">
        We use a small set of cookies for authentication (Clerk) and to track the
        OAuth round-trip with Steam. We don't use third-party analytics or ad
        tracking.
      </Section>

      <Section title="Your rights">
        You can disconnect Twitch and Steam from the Forge page at any time. To
        delete your account and the data tied to it, contact us via the Help
        page.
      </Section>

      <Section title="Children">
        Goblin L00t is not directed at children under 13. If you believe a child
        has provided us data, contact us and we'll delete it.
      </Section>

      <Section title="Contact">
        Questions about privacy? Reach us through the Help &amp; Guide page.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
