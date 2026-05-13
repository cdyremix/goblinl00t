import { useState } from "react";
import { useAuth, useUser } from "@clerk/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Bug, Lightbulb, HelpCircle, MessageSquare,
  Send, Loader2, CheckCircle2, HeartHandshake,
} from "lucide-react";

type Category = "bug" | "feature" | "help" | "other";

const CATEGORIES: {
  value: Category;
  label: string;
  icon: React.ReactNode;
  tagline: string;
  placeholder: string;
  border: string;
  bg: string;
  iconColor: string;
  selectedBorder: string;
  selectedBg: string;
  selectedText: string;
}[] = [
  {
    value: "bug",
    label: "Bug Report",
    icon: <Bug className="w-5 h-5" />,
    tagline: "Something isn't working correctly",
    placeholder: "What happened? What did you expect to happen? Steps to reproduce…",
    border: "border-border/40",
    bg: "bg-muted/10",
    iconColor: "text-red-400",
    selectedBorder: "border-red-500/60",
    selectedBg: "bg-red-500/10",
    selectedText: "text-red-400",
  },
  {
    value: "feature",
    label: "Feature Request",
    icon: <Lightbulb className="w-5 h-5" />,
    tagline: "An idea or improvement suggestion",
    placeholder: "Describe the feature you'd like and why it would be useful…",
    border: "border-border/40",
    bg: "bg-muted/10",
    iconColor: "text-violet-400",
    selectedBorder: "border-violet-500/60",
    selectedBg: "bg-violet-500/10",
    selectedText: "text-violet-400",
  },
  {
    value: "help",
    label: "General Help",
    icon: <HelpCircle className="w-5 h-5" />,
    tagline: "A question about setup or usage",
    placeholder: "What do you need help with? The more detail the better…",
    border: "border-border/40",
    bg: "bg-muted/10",
    iconColor: "text-sky-400",
    selectedBorder: "border-sky-500/60",
    selectedBg: "bg-sky-500/10",
    selectedText: "text-sky-400",
  },
  {
    value: "other",
    label: "Other",
    icon: <MessageSquare className="w-5 h-5" />,
    tagline: "Anything else on your mind",
    placeholder: "Tell us what's on your mind…",
    border: "border-border/40",
    bg: "bg-muted/10",
    iconColor: "text-amber-400",
    selectedBorder: "border-amber-500/60",
    selectedBg: "bg-amber-500/10",
    selectedText: "text-amber-400",
  },
];

export default function SupportPage() {
  const { getToken } = useAuth();
  const { user } = useUser();

  const [category, setCategory] = useState<Category>("help");
  const [email, setEmail]       = useState(user?.primaryEmailAddress?.emailAddress ?? "");
  const [subject, setSubject]   = useState("");
  const [message, setMessage]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const selected = CATEGORIES.find((c) => c.value === category)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken().catch(() => null);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/support/tickets", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string; fields?: Record<string, string> };
        const fieldMsg = body.fields ? Object.values(body.fields)[0] : null;
        setError(fieldMsg ?? body.error ?? "Something went wrong — please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="space-y-1">
            <p className="text-xl font-bold text-foreground">Ticket submitted!</p>
            <p className="text-sm text-muted-foreground">
              We'll get back to you at <span className="text-foreground font-medium">{email}</span> as soon as possible.
            </p>
          </div>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => { setDone(false); setSubject(""); setMessage(""); }}
          >
            Submit another ticket
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <HeartHandshake className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Contact Support</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">
          Report a bug, request a feature, or ask for help — we'll get back to you by email.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6">

        {/* Category picker */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">What can we help with?</p>
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((c) => {
              const isSelected = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150 ${
                    isSelected
                      ? `${c.selectedBorder} ${c.selectedBg}`
                      : `${c.border} ${c.bg} hover:bg-muted/20 hover:border-border/60`
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 ${isSelected ? c.selectedText : c.iconColor}`}>
                    {c.icon}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${isSelected ? c.selectedText : "text-foreground"}`}>
                      {c.label}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {c.tagline}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fields */}
        <Card className={`border transition-colors duration-200 ${selected.selectedBorder}`}>
          <CardContent className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="support-email">Your email</Label>
                <Input
                  id="support-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-subject">Subject</Label>
                <Input
                  id="support-subject"
                  placeholder="Brief summary"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="support-message">Message</Label>
              <Textarea
                id="support-message"
                placeholder={selected.placeholder}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                required
              />
              <p className="text-[10px] text-muted-foreground text-right">{message.length} / 4000</p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Send className="w-4 h-4 mr-2" />}
              Send {selected.label}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
