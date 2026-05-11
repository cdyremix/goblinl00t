export default function Terms() {
  return (
    <div className="prose prose-invert max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-4xl font-bold tracking-tight text-primary">Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Last updated: May 2026</p>

      <Section title="1. Acceptance">
        By using Goblin L00t (the "Service") you agree to these terms. If you don't
        agree, please don't use the Service.
      </Section>

      <Section title="2. The Service">
        Goblin L00t is a Twitch chat bot and dashboard that helps streamers run
        giveaways, loot drops, and chat-based games. We provide the Service as-is
        and reserve the right to change or discontinue features at any time.
      </Section>

      <Section title="3. Your Account">
        You're responsible for the activity that happens on your account. Don't
        share your sign-in credentials, and let us know immediately if you suspect
        your account has been compromised. You must be old enough to use Twitch in
        your jurisdiction in order to use Goblin L00t.
      </Section>

      <Section title="4. Streamer Responsibilities">
        You are solely responsible for any prizes you offer through the Service,
        including delivery, taxes, and compliance with Twitch's giveaway rules and
        local law. Goblin L00t does not handle prize fulfillment — CS2 skins are
        traded peer-to-peer between you and your viewers.
      </Section>

      <Section title="5. Acceptable Use">
        Don't use the Service to harass viewers, run scams, or violate Twitch's
        Terms of Service. We may suspend accounts that abuse the platform.
      </Section>

      <Section title="6. Third-Party Services">
        Goblin L00t connects to Twitch, Steam, Clerk, and (optionally) Discord.
        Your use of those services is governed by their own terms. We are not
        responsible for outages or changes on their side.
      </Section>

      <Section title="7. Disclaimer">
        The Service is provided on an "as is" and "as available" basis. To the
        fullest extent permitted by law, we disclaim all warranties.
      </Section>

      <Section title="8. Limitation of Liability">
        To the maximum extent permitted by law, Goblin L00t is not liable for any
        indirect, incidental, or consequential damages arising from your use of
        the Service.
      </Section>

      <Section title="9. Changes">
        We may update these terms over time. Continued use of the Service after a
        change means you accept the new terms.
      </Section>

      <Section title="10. Contact">
        Questions? Reach us through the Help &amp; Guide page.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </section>
  );
}
