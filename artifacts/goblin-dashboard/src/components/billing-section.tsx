import { useState, useMemo } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard,
  Receipt,
  ExternalLink,
  Loader2,
  Calendar,
  Repeat,
  XCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SubscriptionResponse {
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    priceId: string;
    productName: string;
    tier: string;
    unitAmount: number | null;
    currency: string;
    interval: string | null;
  } | null;
  tier: string;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string;
  amountPaid: number;
  amountDue: number;
  currency: string;
  createdAt: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: number;
  periodEnd: number;
}

const STATUS_OPTIONS = ["all", "paid", "open", "void", "uncollectible"];

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  paid: "border-green-500/40 text-green-400 bg-green-500/10",
  open: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  void: "border-muted-foreground/30 text-muted-foreground",
  uncollectible: "border-destructive/40 text-destructive bg-destructive/10",
  draft: "border-muted-foreground/30 text-muted-foreground",
};

export function BillingSection() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  async function authedFetch(path: string, init: RequestInit = {}) {
    const token = await getToken();
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  const subQuery = useQuery<SubscriptionResponse>({
    queryKey: ["stripe", "subscription"],
    queryFn: async () => {
      const r = await authedFetch("/api/stripe/subscription");
      if (!r.ok) throw new Error("Failed to load subscription");
      return r.json();
    },
  });

  const invoicesQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [statusFilter, fromDate, toDate]);

  const invoicesQuery = useQuery<{ invoices: Invoice[] }>({
    queryKey: ["stripe", "invoices", statusFilter, fromDate, toDate],
    queryFn: async () => {
      const r = await authedFetch(`/api/stripe/invoices${invoicesQueryString}`);
      if (!r.ok) throw new Error("Failed to load invoices");
      return r.json();
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/stripe/portal", { method: "POST" });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to open portal");
      }
      return (await r.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't open billing portal",
        description: err.message,
        variant: "destructive",
      }),
  });

  const cancelToggleMutation = useMutation({
    mutationFn: async (cancel: boolean) => {
      const r = await authedFetch(
        "/api/stripe/subscription/cancel-at-period-end",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancel }),
        },
      );
      if (!r.ok) throw new Error("Failed to update auto-renew");
    },
    onSuccess: (_d, cancel) => {
      queryClient.invalidateQueries({ queryKey: ["stripe", "subscription"] });
      toast({
        title: cancel
          ? "Auto-renew turned off"
          : "Auto-renew turned back on",
        description: cancel
          ? "Your plan stays active until the end of the period."
          : "Your subscription will keep renewing.",
      });
    },
    onError: () =>
      toast({ title: "Failed to update auto-renew", variant: "destructive" }),
  });

  const cancelNowMutation = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/stripe/subscription/cancel-now", {
        method: "POST",
      });
      if (!r.ok) throw new Error("Failed to cancel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stripe", "subscription"] });
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      toast({
        title: "Subscription cancelled",
        description: "You're back on the free tier.",
      });
    },
    onError: () =>
      toast({ title: "Failed to cancel subscription", variant: "destructive" }),
  });

  const sub = subQuery.data?.subscription;

  return (
    <div className="space-y-6">
      {/* Current subscription */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="font-medieval flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Subscription
          </CardTitle>
          <CardDescription>
            Manage your plan, payment method, and auto-renew.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {subQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !sub ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="font-bold text-foreground">No active subscription</p>
                <p className="text-sm text-muted-foreground">
                  You're on the free Cave Dweller tier. Pick a paid rank below to subscribe.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-foreground text-lg">
                      {sub.productName}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        sub.status === "active" || sub.status === "trialing"
                          ? "border-green-500/40 text-green-400 bg-green-500/10"
                          : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      }
                    >
                      {sub.status}
                    </Badge>
                    {sub.cancelAtPeriodEnd && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 text-amber-400"
                      >
                        Cancels at period end
                      </Badge>
                    )}
                  </div>
                  {sub.unitAmount != null && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono text-primary">
                        {formatMoney(sub.unitAmount, sub.currency)}
                      </span>
                      {sub.interval && ` / ${sub.interval}`}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {sub.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
                    {formatDate(sub.currentPeriodEnd)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                  data-testid="button-billing-portal"
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  Open Stripe Portal
                </Button>
              </div>

              <Separator className="opacity-50" />

              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="auto-renew"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Repeat className="w-4 h-4 text-muted-foreground" />
                    Auto-renew billing
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {sub.cancelAtPeriodEnd
                      ? "Off — your plan ends at the period boundary."
                      : "On — your plan renews automatically each month."}
                  </p>
                </div>
                <Switch
                  id="auto-renew"
                  checked={!sub.cancelAtPeriodEnd}
                  disabled={cancelToggleMutation.isPending}
                  onCheckedChange={(checked) =>
                    cancelToggleMutation.mutate(!checked)
                  }
                  data-testid="switch-auto-renew"
                />
              </div>

              <Separator className="opacity-50" />

              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Cancel immediately
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ends your subscription right now and reverts to the free tier.
                    No refund for time already paid.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      data-testid="button-cancel-now"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel now
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Cancel your {sub.productName} subscription?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        You'll lose access to paid features immediately and
                        drop back to the free Cave Dweller tier. You can
                        re-subscribe at any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => cancelNowMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Yes, cancel now
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing history */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="font-medieval flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            Billing History
          </CardTitle>
          <CardDescription>
            Every invoice Stripe has generated for your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-[160px]"
                  data-testid="select-invoice-status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[160px]"
                data-testid="input-invoice-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[160px]"
                data-testid="input-invoice-to"
              />
            </div>
            {(statusFilter !== "all" || fromDate || toDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter("all");
                  setFromDate("");
                  setToDate("");
                }}
              >
                Reset
              </Button>
            )}
          </div>

          <Separator className="opacity-50" />

          {invoicesQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !invoicesQuery.data?.invoices.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No invoices match your filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Period</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {invoicesQuery.data.invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-border/30 last:border-0"
                      data-testid={`row-invoice-${inv.id}`}
                    >
                      <td className="py-2.5 pr-3 text-foreground">
                        {formatDate(inv.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                        {inv.number ?? inv.id.slice(0, 14)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        {formatDate(inv.periodStart)} —{" "}
                        {formatDate(inv.periodEnd)}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-foreground">
                        {formatMoney(
                          inv.status === "paid"
                            ? inv.amountPaid
                            : inv.amountDue,
                          inv.currency,
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge
                          variant="outline"
                          className={
                            STATUS_BADGE_CLASS[inv.status] ??
                            "border-muted-foreground/30 text-muted-foreground"
                          }
                        >
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        {inv.hostedInvoiceUrl && (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
