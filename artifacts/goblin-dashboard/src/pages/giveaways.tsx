import { useListGiveaways, useCreateGiveaway, getListGiveawaysQueryKey, useGetCurrentGiveaway } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Plus, Trophy, ChevronRight, Clock, Hash, Package, Heart, Star, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { InventoryPicker, type PickedItem } from "@/components/inventory-picker";
import { Hint } from "@/components/hint";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  prizeKind: z.enum(["cs2", "bot_item", "bot_coins"]).default("cs2"),
  prize: z.string().min(1, "Prize is required"),
  prizeAssetId: z.string().optional(),
  prizeIconUrl: z.string().optional(),
  prizeBotCoins: z.number().int().positive().optional(),
  prizeBotRarity: z.enum(["common", "uncommon", "rare", "epic", "legendary"]).optional(),
  keyword: z.string().min(1, "Keyword is required").regex(/^\w+$/, "Must be a single word (no spaces)"),
  description: z.string().optional(),
  requireFollower: z.boolean().default(false),
  subscriberOnly: z.boolean().default(false),
  minSubTier: z.enum(["1000", "2000", "3000"]).optional(),
}).refine(
  (v) => v.prizeKind !== "bot_coins" || (v.prizeBotCoins !== undefined && v.prizeBotCoins > 0),
  { path: ["prizeBotCoins"], message: "Coin amount required" },
);

type FormValues = z.infer<typeof formSchema>;

export function Giveaways() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedIcon, setPickedIcon] = useState<string | null>(null);

  const { getToken, isSignedIn } = useAuth();
  const { data: giveaways, isLoading } = useListGiveaways();
  const { data: currentGiveaway } = useGetCurrentGiveaway();

  // Theme is needed so the bot_item / bot_coins prize-source labels read
  // "Skin Drop" in CS2 mode (vs "Loot Drop" in goblin mode). Inline fetch
  // mirrors the pattern in layout.tsx.
  const settingsQuery = useQuery<{ botTheme: "goblin" | "cs2" }>({
    queryKey: ["bot-settings"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const isCS2 = settingsQuery.data?.botTheme === "cs2";
  const botItemLabel = isCS2 ? "Skin Drop" : "Loot Drop";
  const botItemEmoji = isCS2 ? "📦" : "👺";
  const botItemDefaultName = isCS2 ? "Random CS2 Skin" : "Random Goblin Loot";
  const botItemHelpText = isCS2
    ? "Bot rolls a random CS2-themed skin into the winner's inventory."
    : "Goblin rolls a random item into the winner's inventory.";

  const createMutation = useCreateGiveaway();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      prizeKind: "cs2",
      prize: "",
      prizeAssetId: undefined,
      prizeIconUrl: undefined,
      prizeBotCoins: undefined,
      prizeBotRarity: undefined,
      keyword: "loot",
      description: "",
      requireFollower: false,
      subscriberOnly: false,
      minSubTier: undefined,
    },
  });

  const subscriberOnly = form.watch("subscriberOnly");
  const prizeKind = form.watch("prizeKind");

  function handlePick(item: PickedItem) {
    form.setValue("prize", item.marketHashName, { shouldValidate: true });
    form.setValue("prizeAssetId", item.assetId);
    form.setValue("prizeIconUrl", item.iconUrl);
    setPickedIcon(item.iconUrl);
    setPickerOpen(false);
  }

  function onSubmit(values: FormValues) {
    const isCs2 = values.prizeKind === "cs2";
    createMutation.mutate(
      {
        data: {
          title: values.title,
          prizeKind: values.prizeKind,
          prize: values.prize,
          prizeAssetId: isCs2 ? values.prizeAssetId : undefined,
          prizeIconUrl: isCs2 ? values.prizeIconUrl : undefined,
          prizeBotCoins: values.prizeKind === "bot_coins" ? values.prizeBotCoins : undefined,
          prizeBotRarity: values.prizeKind === "bot_item" ? values.prizeBotRarity : undefined,
          keyword: values.keyword,
          description: values.description,
          requireFollower: values.requireFollower,
          subscriberOnly: values.subscriberOnly,
          minSubTier: values.subscriberOnly ? values.minSubTier : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Giveaway created",
            description: "Ready to be started from the hoard list.",
          });
          form.reset();
          setPickedIcon(null);
          queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
        },
        onError: () => {
          toast({
            title: "Failed to create",
            description: "The goblin refused. Try again.",
            variant: "destructive",
          });
        },
      }
    );
  }

  const filteredGiveaways = giveaways?.filter((g) => {
    if (filter === "all") return true;
    return g.status === filter;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-primary">Loot Hoard</h1>
        <p className="text-muted-foreground mt-2 text-lg">Manage your giveaways and hand out the goods.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-1">
          <Card className="border-border/50 sticky top-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                Forge New Giveaway
              </CardTitle>
              <CardDescription>Setup the loot. You start it manually later.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Epic Mount Drop" {...field} className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Prize source selector */}
                  <FormField
                    control={form.control}
                    name="prizeKind"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prize Source</FormLabel>
                        <div className="grid grid-cols-3 gap-1.5 rounded-md border border-input bg-background p-1">
                          {([
                            { v: "cs2", label: "CS2 Skin", emoji: "🔫" },
                            { v: "bot_item", label: botItemLabel, emoji: botItemEmoji },
                            { v: "bot_coins", label: "Coins", emoji: "🪙" },
                          ] as const).map((opt) => (
                            <button
                              key={opt.v}
                              type="button"
                              onClick={() => {
                                field.onChange(opt.v);
                                if (opt.v !== "cs2") {
                                  form.setValue("prizeAssetId", undefined);
                                  form.setValue("prizeIconUrl", undefined);
                                  setPickedIcon(null);
                                }
                                if (opt.v === "bot_coins") {
                                  form.setValue("prize", "Bag of Coins", { shouldValidate: true });
                                } else if (opt.v === "bot_item") {
                                  form.setValue("prize", botItemDefaultName, { shouldValidate: true });
                                } else {
                                  form.setValue("prize", "", { shouldValidate: false });
                                }
                              }}
                              data-testid={`tab-prize-${opt.v}`}
                              className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs font-medium transition-all ${
                                field.value === opt.v
                                  ? "bg-primary text-primary-foreground shadow"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              }`}
                            >
                              <span>{opt.emoji}</span>
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      </FormItem>
                    )}
                  />

                  {prizeKind === "cs2" && (
                    <FormField
                      control={form.control}
                      name="prize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CS2 Skin</FormLabel>
                          <FormControl>
                            <button
                              type="button"
                              onClick={() => setPickerOpen(true)}
                              className="w-full flex items-center gap-3 p-3 rounded-md border border-input bg-background text-left hover:border-primary/50 transition-colors"
                              data-testid="button-open-prize-picker"
                            >
                              {pickedIcon ? (
                                <img src={pickedIcon} alt="" className="w-12 h-12 object-contain rounded bg-background/50 shrink-0" />
                              ) : (
                                <div className="w-12 h-12 flex items-center justify-center rounded bg-muted shrink-0">
                                  <Package className="w-5 h-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                {field.value ? (
                                  <span className="text-sm font-medium text-foreground truncate block">{field.value}</span>
                                ) : (
                                  <span className="text-sm text-muted-foreground">Click to pick from your CS2 inventory</span>
                                )}
                              </div>
                            </button>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {prizeKind === "bot_item" && (
                    <>
                      <FormField
                        control={form.control}
                        name="prize"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Display Name</FormLabel>
                            <FormControl>
                              <Input placeholder={botItemDefaultName} {...field} className="bg-background" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="prizeBotRarity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rarity Hint (optional)</FormLabel>
                            <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || undefined)}>
                              <FormControl>
                                <SelectTrigger className="bg-background" data-testid="select-bot-rarity">
                                  <SelectValue placeholder="Any rarity (winner gets a juiced roll)" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="common">Common</SelectItem>
                                <SelectItem value="uncommon">Uncommon</SelectItem>
                                <SelectItem value="rare">Rare</SelectItem>
                                <SelectItem value="epic">Epic</SelectItem>
                                <SelectItem value="legendary">Legendary</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">{botItemHelpText}</p>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {prizeKind === "bot_coins" && (
                    <>
                      <FormField
                        control={form.control}
                        name="prize"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Display Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Bag of Coins" {...field} className="bg-background" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="prizeBotCoins"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Coin Amount</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="1000"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                                  className="pl-9 bg-background"
                                  data-testid="input-bot-coins"
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  <FormField
                    control={form.control}
                    name="keyword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Keyword</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">!</span>
                            <Input placeholder="loot" {...field} className="pl-6 bg-background" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Details for the viewers..." {...field} className="resize-none bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Gating */}
                  <div className="space-y-3 rounded-md border border-border/50 bg-background/30 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Entry Requirements</p>

                    <FormField
                      control={form.control}
                      name="requireFollower"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between gap-3 space-y-0">
                          <div className="flex items-center gap-2">
                            <Heart className="w-4 h-4 text-pink-400" />
                            <Label htmlFor="req-follower" className="text-sm font-normal cursor-pointer">
                              Followers only
                            </Label>
                          </div>
                          <FormControl>
                            <Switch
                              id="req-follower"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-require-follower"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="subscriberOnly"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between gap-3 space-y-0">
                          <div className="flex items-center gap-2">
                            <Star className="w-4 h-4 text-purple-400" />
                            <Label htmlFor="sub-only" className="text-sm font-normal cursor-pointer">
                              Subscribers only
                            </Label>
                          </div>
                          <FormControl>
                            <Switch
                              id="sub-only"
                              checked={field.value}
                              onCheckedChange={(v) => {
                                field.onChange(v);
                                if (!v) form.setValue("minSubTier", undefined);
                              }}
                              data-testid="switch-subscriber-only"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {subscriberOnly && (
                      <FormField
                        control={form.control}
                        name="minSubTier"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">Minimum tier</FormLabel>
                            <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || undefined)}>
                              <FormControl>
                                <SelectTrigger className="bg-background" data-testid="select-min-tier">
                                  <SelectValue placeholder="Any tier" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="1000">Tier 1+</SelectItem>
                                <SelectItem value="2000">Tier 2+</SelectItem>
                                <SelectItem value="3000">Tier 3 only</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>

                  <div className="flex items-start gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 p-3 text-xs text-muted-foreground">
                    <Coins className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Viewers can also <span className="font-mono text-amber-400">!redeem</span> coins for extra entries (100 coins = 1 entry).
                    </span>
                  </div>

                  <Button type="submit" disabled={createMutation.isPending} className="w-full font-bold">
                    {createMutation.isPending ? "Forging..." : "Add to Hoard"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* List */}
        <div className="lg:col-span-2 space-y-6">
          <QuickPrizePanel />
          <div className="flex items-center gap-2 pb-4 border-b border-border/50 overflow-x-auto">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All Loot</FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Active</FilterButton>
            <FilterButton active={filter === "pending"} onClick={() => setFilter("pending")}>Pending</FilterButton>
            <FilterButton active={filter === "ended"} onClick={() => setFilter("ended")}>Ended</FilterButton>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="border-border/50">
                  <CardContent className="p-6 flex items-center justify-between">
                    <div className="space-y-3 w-1/2">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <Skeleton className="h-10 w-24" />
                  </CardContent>
                </Card>
              ))
            ) : filteredGiveaways && filteredGiveaways.length > 0 ? (
              filteredGiveaways.map((giveaway) => {
                const isActive = giveaway.status === "active";
                const isCurrent = currentGiveaway?.giveaway?.id === giveaway.id;

                return (
                  <Link key={giveaway.id} href={`/giveaway/${giveaway.id}`}>
                    <Card className={`border-border/50 hover:border-primary/50 transition-all cursor-pointer group ${isActive ? "bg-primary/5" : "bg-card/50"}`}>
                      <CardContent className="p-5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {giveaway.prizeIconUrl ? (
                            <img
                              src={giveaway.prizeIconUrl}
                              alt=""
                              className="w-12 h-12 object-contain rounded bg-background/40 shrink-0"
                            />
                          ) : giveaway.prizeKind === "bot_coins" ? (
                            <div className="w-12 h-12 flex items-center justify-center rounded bg-amber-500/15 border border-amber-500/30 shrink-0">
                              <Coins className="w-6 h-6 text-amber-400" />
                            </div>
                          ) : giveaway.prizeKind === "bot_item" ? (
                            <div className="w-12 h-12 flex items-center justify-center rounded bg-green-500/15 border border-green-500/30 shrink-0 text-2xl">
                              👺
                            </div>
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="font-bold text-lg text-foreground truncate group-hover:text-primary transition-colors">{giveaway.title}</h3>
                              <StatusBadge status={giveaway.status} isCurrent={isCurrent} />
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1.5">
                                <Trophy className="w-3.5 h-3.5" /> {giveaway.prize}
                                {giveaway.prizeKind === "bot_coins" && giveaway.prizeBotCoins ? (
                                  <span className="text-amber-400 font-mono ml-1">({giveaway.prizeBotCoins} coins)</span>
                                ) : null}
                              </span>
                              <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /> !{giveaway.keyword}</span>
                              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {new Date(giveaway.createdAt).toLocaleDateString()}</span>
                              {giveaway.requireFollower && (
                                <span className="flex items-center gap-1 text-pink-400"><Heart className="w-3 h-3" /> followers</span>
                              )}
                              {giveaway.subscriberOnly && (
                                <span className="flex items-center gap-1 text-purple-400">
                                  <Star className="w-3 h-3" /> subs{giveaway.minSubTier ? ` T${Number(giveaway.minSubTier) / 1000}+` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-4">
                          <div className="text-right hidden sm:block">
                            <div className="text-2xl font-mono font-bold">{giveaway.entryCount}</div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider">Entries</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors group-hover:translate-x-1" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })
            ) : (
              <div className="text-center py-16 border border-dashed border-border/50 rounded-lg">
                <p className="text-muted-foreground">No loot found matching this filter.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <InventoryPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={handlePick} />
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(255,180,0,0.3)]"
          : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-border/80"
      }`}
    >
      {children}
    </button>
  );
}

// =====================================================================
// Quick Prize panel — manual streamer drop of coins or a random item
// =====================================================================

function QuickPrizePanel() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [kind, setKind] = useState<"coins" | "item">("coins");
  const [coins, setCoins] = useState("100");
  const [rarity, setRarity] = useState<"" | "common" | "uncommon" | "rare" | "epic" | "legendary">("");

  const drop = useMutation<
    {
      ok: boolean;
      kind: "coins" | "item";
      username: string;
      coinsAwarded: number | null;
      itemAwarded: string | null;
      rarity: string | null;
      inventoryFull: boolean;
    },
    Error,
    { username: string; kind: "coins" | "item"; coins?: number; rarity?: string }
  >({
    mutationFn: async (body) => {
      const token = await getToken();
      const res = await fetch("/api/loot-hoard/drop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to drop prize");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate loot/points/leaderboard so the drop appears immediately.
      queryClient.invalidateQueries({ queryKey: ["recent-loot"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["points-balance"] });
      const desc =
        data.kind === "coins"
          ? `+${data.coinsAwarded} coins to @${data.username}`
          : data.inventoryFull
            ? `Pouch was full — credited ${data.coinsAwarded} coins to @${data.username} instead.`
            : `${data.itemAwarded} (${data.rarity}) → @${data.username}`;
      toast({ title: "🎁 Prize dropped!", description: desc });
    },
    onError: (err) => toast({ title: "Drop failed", description: err.message, variant: "destructive" }),
  });

  const usernameValid = /^[a-zA-Z0-9_]{1,30}$/.test(username.trim());
  const coinsNum = Math.floor(Number(coins));
  const coinsValid = kind !== "coins" || (Number.isFinite(coinsNum) && coinsNum > 0);
  const canSubmit = usernameValid && coinsValid && !drop.isPending;

  function handleDrop(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    drop.mutate({
      username: username.trim().toLowerCase(),
      kind,
      coins: kind === "coins" ? coinsNum : undefined,
      rarity: kind === "item" && rarity ? rarity : undefined,
    });
  }

  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-purple-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="w-4 h-4 text-amber-400" />
          Quick Prize Drop
          <Hint
            text="Manually drop coins or a random item to a viewer — perfect for shoutouts, mod rewards, or apologies. Coins post to the leaderboard; items roll into the viewer's pouch (falls back to coins if their pouch is full)."
            side="right"
          />
        </CardTitle>
        <CardDescription className="text-xs">
          Hand a viewer a fistful of coins or a random item, no giveaway needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleDrop} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <Input
              placeholder="twitch_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              data-testid="input-quick-prize-username"
              className={!usernameValid && username.length > 0 ? "border-destructive" : ""}
            />
            <div className="flex rounded-md border border-input overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setKind("coins")}
                className={`px-3 py-2 font-medium ${kind === "coins" ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:bg-muted/50"}`}
                data-testid="tab-quick-prize-coins"
              >
                🪙 Coins
              </button>
              <button
                type="button"
                onClick={() => setKind("item")}
                className={`px-3 py-2 font-medium ${kind === "item" ? "bg-purple-500/20 text-purple-300" : "text-muted-foreground hover:bg-muted/50"}`}
                data-testid="tab-quick-prize-item"
              >
                ✨ Item
              </button>
            </div>
          </div>

          {kind === "coins" ? (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="100"
                value={coins}
                onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ""))}
                className="max-w-[140px]"
                data-testid="input-quick-prize-coins"
              />
              <span className="text-xs text-muted-foreground">coins to drop</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value as typeof rarity)}
                className="rounded-md border border-input bg-background text-sm px-3 py-2"
                data-testid="select-quick-prize-rarity"
              >
                <option value="">Random rarity</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="epic">Epic</option>
                <option value="legendary">Legendary</option>
              </select>
              <span className="text-xs text-muted-foreground">item from the loot table</span>
            </div>
          )}

          <Button type="submit" disabled={!canSubmit} className="w-full font-bold gap-2" data-testid="button-quick-prize-drop">
            {drop.isPending ? "Dropping…" : <>🎁 Drop Prize</>}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, isCurrent }: { status: string; isCurrent?: boolean }) {
  if (status === "active") return <Badge className="bg-primary/20 text-primary border-primary/30">ACTIVE {isCurrent && "(LIVE)"}</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-muted-foreground border-border">PENDING</Badge>;
  if (status === "ended") return <Badge variant="secondary" className="bg-muted text-muted-foreground">ENDED</Badge>;
  return null;
}
