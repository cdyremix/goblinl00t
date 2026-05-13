import {
  useListGiveaways, useCreateGiveaway, getListGiveawaysQueryKey, useGetCurrentGiveaway,
  getGetCurrentGiveawayQueryKey,
  useSeedGiveawayEntries,
  useStartGiveaway, useEndGiveaway, useDeleteGiveaway, useSeedTestGiveaway,
  useGetGiveawayEntries, useGetBotSettings,
  getGetGiveawayEntriesQueryKey, getGetBotSettingsQueryKey,
} from "@workspace/api-client-react";
import type { Giveaway } from "@workspace/api-client-react";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Plus, Trophy, ChevronRight, Clock, Hash, Package, Heart, Star, Coins, Trash2, FlaskConical, Play, Sparkles, Users, ChevronDown, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { InventoryPicker, type PickedItem } from "@/components/inventory-picker";
import { Hint } from "@/components/hint";
import { EliminationWheel } from "@/components/elimination-wheel";
import { useSubscriptionTier, LockedHint } from "@/hooks/use-tier";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  // Expanded by default — the create form is the primary action on this
  // page, so we show it up front rather than tucked behind a "+ New" toggle.
  const [createFormOpen, setCreateFormOpen] = useState(true);

  const { data: giveaways, isLoading } = useListGiveaways();
  const { data: currentGiveaway } = useGetCurrentGiveaway();
  const { hasFeature: hasTierFeature, isAdmin, isStaff } = useSubscriptionTier();
  const hasUnlimited = hasTierFeature("unlimited-giveaways");

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
    // Free tier is capped at one concurrent giveaway. We count anything
    // not yet ended (pending OR active) — both block a second create so
    // the streamer doesn't end up with a queue they can't use. Premium+
    // users have unlimited concurrent giveaways.
    const concurrent = (giveaways ?? []).filter(
      (g) => g.status === "pending" || g.status === "active",
    ).length;
    if (!hasUnlimited && concurrent >= 1) {
      toast({
        title: "One giveaway at a time",
        description: "Free tier supports a single active giveaway. Upgrade to Horde Master for unlimited concurrent giveaways.",
        variant: "destructive",
      });
      return;
    }
    const isCs2 = values.prizeKind === "cs2";
    createMutation.mutate(
      {
        data: {
          title: values.title,
          prizeKind: values.prizeKind,
          prize: values.prize,
          prizeAssetId: isCs2 ? values.prizeAssetId : undefined,
          prizeIconUrl: isCs2 ? values.prizeIconUrl : undefined,
          // Coin amount carries through for all prize kinds: it's the main reward
          // for `bot_coins` and an optional bonus for `cs2` / `bot_item`.
          prizeBotCoins: values.prizeBotCoins,
          // Rarity hint applies to `bot_item` rolls; on `cs2` it's cosmetic flavor
          // (the picked skin is what's actually delivered).
          prizeBotRarity: values.prizeKind === "bot_coins" ? undefined : values.prizeBotRarity,
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
            description: "Ready to be started from the horde list.",
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

  // Pick the "spotlight" giveaway: the live one if any, else the most recent
  // pending. This is what the hero card features so the streamer always lands
  // on the most relevant action (start it, spin it, or pick a fresh preset).
  const spotlight =
    currentGiveaway?.giveaway ??
    giveaways?.find((g) => g.status === "pending") ??
    null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-primary">Loot Horde</h1>
          <p className="text-muted-foreground mt-2 text-lg">Run giveaways. Spin the wheel. Hand out the goods.</p>
        </div>
        <TestGiveawayButton />
      </div>

      {/* Hero — the streamer's primary action lives here. */}
      <SpotlightCard giveaway={spotlight} canSeedTest={isAdmin || isStaff} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Form */}
        <div className="lg:col-span-1">
          <Card className="border-border/50 sticky top-8">
            <Collapsible open={createFormOpen} onOpenChange={setCreateFormOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-3 px-6 py-5 text-left hover:bg-muted/20 transition-colors rounded-t-lg"
                  data-testid="button-toggle-create-form"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <Plus className="w-5 h-5 text-primary shrink-0" />
                      Forge New Giveaway
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Setup the loot. You start it manually later.</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${createFormOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
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
                        <Select
                          value={field.value}
                          onValueChange={(v) => {
                            const next = v as "cs2" | "bot_item" | "bot_coins";
                            field.onChange(next);
                            if (next !== "cs2") {
                              form.setValue("prizeAssetId", undefined);
                              form.setValue("prizeIconUrl", undefined);
                              setPickedIcon(null);
                            }
                            if (next === "bot_coins") {
                              form.setValue("prize", "Bag of Coins", { shouldValidate: true });
                            } else if (next === "bot_item") {
                              form.setValue("prize", "Random Goblin Loot", { shouldValidate: true });
                            } else {
                              form.setValue("prize", "", { shouldValidate: false });
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-background" data-testid="select-prize-source">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="cs2">🔫 CS2 Skin</SelectItem>
                            <SelectItem value="bot_item">👺 Goblin Horde</SelectItem>
                            <SelectItem value="bot_coins">🪙 Coins</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  {prizeKind === "cs2" && (
                    <>
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
                      <FormField
                        control={form.control}
                        name="prizeBotCoins"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Bonus Coins (optional)</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="0"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                                  className="pl-9 bg-background"
                                  data-testid="input-cs2-bonus-coins"
                                />
                              </div>
                            </FormControl>
                            <p className="text-[11px] text-muted-foreground">Awarded to the winner on top of the skin.</p>
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
                                <SelectTrigger className="bg-background" data-testid="select-cs2-rarity">
                                  <SelectValue placeholder="Any rarity" />
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
                            <p className="text-[11px] text-muted-foreground">Cosmetic flavor for the announcement.</p>
                          </FormItem>
                        )}
                      />
                    </>
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
                              <Input placeholder="Random Goblin Loot" {...field} className="bg-background" />
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
                            <FormLabel>Bonus Coins (optional)</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="0"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                                  className="pl-9 bg-background"
                                  data-testid="input-bot-item-bonus-coins"
                                />
                              </div>
                            </FormControl>
                            <p className="text-[11px] text-muted-foreground">Awarded to the winner on top of the loot.</p>
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
                            <p className="text-[11px] text-muted-foreground">Goblin rolls a random item into the winner's inventory.</p>
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

                  <Button type="submit" disabled={createMutation.isPending} className="w-full font-bold" data-testid="button-create-giveaway">
                    {createMutation.isPending ? "Forging..." : "Create Giveaway"}
                  </Button>
                </form>
              </Form>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* List */}
        <div className="lg:col-span-2 space-y-6">
          <CollapsibleSection
            title="Quick Prize Drop"
            icon={<Coins className="w-4 h-4 text-amber-400" />}
            description="Hand a viewer coins or a random item — no giveaway needed."
          >
            <QuickPrizePanel />
          </CollapsibleSection>
          <div className="space-y-3 pb-4 border-b border-border/50">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                Your Giveaways
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Every giveaway you've forged. Filter by status, then start, spin, or delete.
              </p>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All Loot</FilterButton>
              <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Active</FilterButton>
              <FilterButton active={filter === "pending"} onClick={() => setFilter("pending")}>Pending</FilterButton>
              <FilterButton active={filter === "ended"} onClick={() => setFilter("ended")}>Ended</FilterButton>
            </div>
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
              filteredGiveaways.map((giveaway) => (
                <GiveawayRow
                  key={giveaway.id}
                  giveaway={giveaway}
                  isCurrent={currentGiveaway?.giveaway?.id === giveaway.id}
                />
              ))
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

// Shown to admin/staff accounts only — lets them forge a pre-seeded giveaway
// to test the elimination wheel without waiting for real chat entries.
// Visible in both dev and production builds; the server gates on isAdmin||isStaff.
function TestGiveawayButton() {
  const { isAdmin, isStaff } = useSubscriptionTier();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const seedTest = useSeedTestGiveaway();

  if (!isAdmin && !isStaff) return null;

  return (
    <Button
      variant="outline"
      onClick={() =>
        seedTest.mutate(undefined, {
          onSuccess: () => {
            toast({
              title: "🧪 Test giveaway forged",
              description: "Loaded with ~30 fake entries — spin the wheel whenever you're ready.",
            });
            queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetCurrentGiveawayQueryKey() });
          },
          onError: () =>
            toast({
              title: "Couldn't create test giveaway",
              description: "Something went wrong. Make sure your account has admin or dev access.",
              variant: "destructive",
            }),
        })
      }
      disabled={seedTest.isPending}
      className="gap-2 border-dashed border-primary/40 text-primary hover:bg-primary/10"
      data-testid="button-create-test-giveaway"
    >
      <FlaskConical className="w-4 h-4" />
      {seedTest.isPending ? "Forging…" : "Create Test Giveaway"}
    </Button>
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

// Giveaway Presets (SavePresetButton + PresetsPanel) lived here. Removed
// per UX simplification — streamers asked to drop the saved-preset
// workflow because the create form is fast enough on its own and the
// presets panel was visual clutter on the Loot Horde. The DB table and
// /giveaway-presets routes still exist for back-compat with any
// pre-existing preset rows, but no UI surfaces them anymore.

function StatusBadge({ status, isCurrent }: { status: string; isCurrent?: boolean }) {
  if (status === "active") return <Badge className="bg-primary/20 text-primary border-primary/30">ACTIVE {isCurrent && "(LIVE)"}</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-muted-foreground border-border">PENDING</Badge>;
  if (status === "ended") return <Badge variant="secondary" className="bg-muted text-muted-foreground">ENDED</Badge>;
  return null;
}

// =====================================================================
// CollapsibleSection — wraps a side panel in a click-to-open card so
// the right column doesn't scream for attention. Closed by default.
// =====================================================================

function CollapsibleSection({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/50 bg-card/40">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
            data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {icon}
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">{title}</p>
                {description && (
                  <p className="text-xs text-muted-foreground truncate">{description}</p>
                )}
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-5 pb-5 pt-1 border-t border-border/50">{children}</div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// =====================================================================
// SpotlightCard — top-of-page hero. Surfaces the active giveaway (or the
// most recent pending) with the streamer's #1 action front-and-center:
//   • Pending → Start Giveaway
//   • Active  → Spin Wheel (opens the EliminationWheel modal inline so
//     the streamer never has to bounce into the detail page just to draw)
// Always exposes a "+ Add 30 test entries" button so the wheel can be
// demoed without waiting for chat to type.
// =====================================================================

function SpotlightCard({ giveaway, canSeedTest }: { giveaway: Giveaway | null | undefined; canSeedTest: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isSignedIn } = useAuth();

  const startMutation = useStartGiveaway();
  const endMutation = useEndGiveaway();
  const seedEntries = useSeedGiveawayEntries();

  // Wheel settings come from /api/settings.
  const { data: botSettings } = useGetBotSettings({
    query: { enabled: !!isSignedIn, queryKey: getGetBotSettingsQueryKey() },
  });
  const wheelMode = (botSettings?.wheelMode === "manual" ? "manual" : "auto") as "auto" | "manual";
  const wheelSpeed = (
    botSettings?.wheelSpeed === "slow" || botSettings?.wheelSpeed === "fast"
      ? botSettings.wheelSpeed
      : "medium"
  ) as "slow" | "medium" | "fast";
  const flavorEnabled = botSettings?.eliminationFlavorEnabled ?? true;

  // Pre-fetch entries for the spotlighted giveaway so the wheel modal can
  // animate against the real roster the moment the streamer hits Spin.
  const { data: entries } = useGetGiveawayEntries(giveaway?.id ?? 0, {
    query: {
      enabled: !!giveaway?.id,
      queryKey: getGetGiveawayEntriesQueryKey(giveaway?.id ?? 0),
    },
  });

  const [wheelOpen, setWheelOpen] = useState(false);
  // Tracks whether the wheel actually ran an elimination this open (vs
  // the streamer dismissing without spinning). Drives whether we
  // refetch on close — avoids button flicker when nothing happened.
  const [didDraw, setDidDraw] = useState(false);

  function invalidate(id: number) {
    queryClient.invalidateQueries({ queryKey: getGetGiveawayEntriesQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetCurrentGiveawayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
  }

  // Empty state — no live or pending giveaway.
  if (!giveaway) {
    return (
      <Card className="border-dashed border-border/60 bg-gradient-to-br from-muted/20 to-transparent">
        <CardContent className="py-10 px-6 text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">No live giveaway right now</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Forge one with the form below, or launch a saved preset. The wheel spin happens right here — no clicking around.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isPending = giveaway.status === "pending";
  const isActive = giveaway.status === "active";
  const entryCount = giveaway.entryCount ?? 0;
  const needsTestEntries = canSeedTest && entryCount < 5;

  function handleSeed() {
    if (!giveaway) return;
    seedEntries.mutate(
      { id: giveaway.id },
      {
        onSuccess: (g) => {
          toast({
            title: "Test entries added",
            description: `${g.entryCount} total entries — ready to spin.`,
          });
          invalidate(giveaway.id);
        },
        onError: () => toast({ title: "Couldn't seed entries", variant: "destructive" }),
      },
    );
  }

  function handleStart() {
    if (!giveaway) return;
    startMutation.mutate(
      { id: giveaway.id },
      {
        onSuccess: () => {
          toast({ title: "Giveaway started!", description: "The goblin announced it in chat." });
          invalidate(giveaway.id);
        },
        onError: () => toast({ title: "Couldn't start", variant: "destructive" }),
      },
    );
  }

  // Opening the wheel never touches the server. The wheel itself runs
  // real eliminations; whoever's left at the end IS the winner, and
  // the wheel reports them via `onWinnerDecided` — only THEN do we
  // call the server end-mutation. Closing the modal without spinning
  // leaves the giveaway active.
  function handleSpin() {
    if (!giveaway) return;
    setDidDraw(false);
    setWheelOpen(true);
  }

  function handleWinnerDecided(username: string) {
    if (!giveaway) return;
    setDidDraw(true);
    endMutation.mutate(
      { id: giveaway.id, data: { winnerUsername: username } },
      {
        onSuccess: () => {
          toast({ title: `Winner: ${username}`, description: "Recorded — chat has been notified." });
          invalidate(giveaway.id);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Couldn't record winner";
          toast({ title: "Failed to record winner", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleWheelClose() {
    setWheelOpen(false);
    if (giveaway && didDraw) invalidate(giveaway.id);
  }

  return (
    <>
      <Card
        className={`border-2 ${isActive ? "border-primary/50 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-[0_0_40px_rgba(255,180,0,0.15)]" : "border-border/60 bg-card/60"}`}
        data-testid="card-spotlight-giveaway"
      >
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            {/* Prize visual */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {giveaway.prizeIconUrl ? (
                <img
                  src={giveaway.prizeIconUrl}
                  alt=""
                  className="w-20 h-20 object-contain rounded-lg bg-background/40 shrink-0"
                />
              ) : giveaway.prizeKind === "bot_coins" ? (
                <div className="w-20 h-20 flex items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 shrink-0">
                  <Coins className="w-10 h-10 text-amber-400" />
                </div>
              ) : (
                <div className="w-20 h-20 flex items-center justify-center rounded-lg bg-green-500/15 border border-green-500/30 shrink-0 text-4xl">
                  👺
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <StatusBadge status={giveaway.status} isCurrent={isActive} />
                  <span className="text-xs text-muted-foreground font-mono">!{giveaway.keyword}</span>
                </div>
                <h2 className="text-2xl font-bold text-foreground truncate">{giveaway.title}</h2>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" />
                  {giveaway.prize}
                  {giveaway.prizeKind === "bot_coins" && giveaway.prizeBotCoins ? (
                    <span className="text-amber-400 font-mono ml-1">({giveaway.prizeBotCoins} coins)</span>
                  ) : null}
                </p>
              </div>
            </div>

            {/* Entry count */}
            <div className="flex items-center gap-6 lg:border-l lg:border-border/50 lg:pl-6">
              <div className="text-center">
                <div className="text-4xl font-mono font-bold text-foreground" data-testid="text-spotlight-entry-count">
                  {entryCount}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                  Entries
                </div>
              </div>
            </div>

            {/* Primary action */}
            <div className="flex flex-col gap-2 lg:min-w-[200px]">
              {isPending && (
                <Button
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                  size="lg"
                  className="font-bold gap-2 shadow-[0_0_20px_rgba(255,180,0,0.25)]"
                  data-testid="button-spotlight-start"
                >
                  <Play className="w-4 h-4" />
                  {startMutation.isPending ? "Starting…" : "Start Giveaway"}
                </Button>
              )}
              {isActive && (
                <Button
                  onClick={handleSpin}
                  disabled={endMutation.isPending || entryCount === 0}
                  size="lg"
                  className="font-bold gap-2 bg-primary text-primary-foreground shadow-[0_0_20px_rgba(255,180,0,0.4)]"
                  data-testid="button-spotlight-spin"
                >
                  <Zap className="w-4 h-4" />
                  {endMutation.isPending ? "Recording…" : "🎡 Spin Wheel"}
                </Button>
              )}
              {needsTestEntries && (
                <Button
                  onClick={handleSeed}
                  disabled={seedEntries.isPending}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-dashed border-primary/40 text-primary hover:bg-primary/10"
                  data-testid="button-spotlight-seed-entries"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  {seedEntries.isPending ? "Seeding…" : "+ 30 test entries"}
                </Button>
              )}
              <Link
                href={`/giveaway/${giveaway.id}`}
                className="text-xs text-center text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                data-testid="link-spotlight-detail"
              >
                Open detail page →
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <EliminationWheel
        open={wheelOpen}
        onClose={handleWheelClose}
        entries={(entries ?? []).map((e) => ({ id: e.id, username: e.username, tickets: e.tickets }))}
        mode={wheelMode}
        speed={wheelSpeed}
        flavorEnabled={flavorEnabled}
        onWinnerDecided={handleWinnerDecided}
        recordingWinner={endMutation.isPending}
      />
    </>
  );
}

// =====================================================================
// GiveawayRow — list item with inline actions. Click anywhere on the
// title/prize area to open the detail page; the action buttons on the
// right are scoped click handlers (stopPropagation) so they don't fire
// the navigation. Pending rows can be started in place; active rows
// expose a "Spin" shortcut; rows with <5 entries get a "+ Test" button.
// =====================================================================

function GiveawayRow({ giveaway, isCurrent }: { giveaway: Giveaway; isCurrent: boolean }) {
  const isActive = giveaway.status === "active";
  const isPending = giveaway.status === "pending";
  const isEnded = giveaway.status === "ended";
  const entryCount = giveaway.entryCount ?? 0;

  const { isAdmin: rowIsAdmin, isStaff: rowIsStaff } = useSubscriptionTier();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const seedEntries = useSeedGiveawayEntries();
  const startMutation = useStartGiveaway();
  const deleteMutation = useDeleteGiveaway();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCurrentGiveawayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetGiveawayEntriesQueryKey(giveaway.id) });
  }

  // Open the styled AlertDialog instead of the browser's native confirm().
  // The trash-can button is inside a Link, so we stop propagation/default
  // to keep the user from being navigated to the detail page mid-confirm.
  function openDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteOpen(true);
  }

  function confirmDelete() {
    deleteMutation.mutate(
      { id: giveaway.id },
      {
        onSuccess: () => {
          toast({ title: "Giveaway deleted" });
          setDeleteOpen(false);
          invalidate();
        },
        onError: () => toast({ title: "Couldn't delete", variant: "destructive" }),
      },
    );
  }

  function handleSeed(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    seedEntries.mutate(
      { id: giveaway.id },
      {
        onSuccess: (g) => {
          toast({ title: "Test entries added", description: `${g.entryCount} total entries.` });
          invalidate();
        },
        onError: () => toast({ title: "Couldn't seed", variant: "destructive" }),
      },
    );
  }

  function handleStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startMutation.mutate(
      { id: giveaway.id },
      {
        onSuccess: () => {
          toast({ title: "Giveaway started!" });
          invalidate();
        },
        onError: () => toast({ title: "Couldn't start", variant: "destructive" }),
      },
    );
  }

  return (
    <Card className={`border-border/50 hover:border-primary/50 transition-all group ${isActive ? "bg-primary/5" : "bg-card/50"}`}>
      <CardContent className="p-5 flex items-center justify-between gap-4">
        <Link
          href={`/giveaway/${giveaway.id}`}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          data-testid={`link-giveaway-${giveaway.id}`}
        >
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
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {entryCount} entries</span>
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
        </Link>
        <div className="shrink-0 flex items-center gap-2">
          {(isPending || isActive) && entryCount < 5 && (rowIsAdmin || rowIsStaff) && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSeed}
              disabled={seedEntries.isPending}
              className="gap-1 border-dashed border-primary/30 text-primary hover:bg-primary/10 hidden sm:inline-flex"
              data-testid={`button-row-seed-${giveaway.id}`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              + Test
            </Button>
          )}
          {isPending && (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="gap-1 font-bold"
              data-testid={`button-row-start-${giveaway.id}`}
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </Button>
          )}
          {isEnded && giveaway.winnerUsername && (
            <span className="text-xs text-amber-400 font-mono hidden md:inline-flex items-center gap-1">
              👑 {giveaway.winnerUsername}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={openDelete}
            disabled={deleteMutation.isPending}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8"
            title="Delete giveaway"
            data-testid={`button-row-delete-${giveaway.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {/* Decorative — the title-area Link already handles navigation. */}
          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
        </div>
      </CardContent>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid={`dialog-delete-giveaway-${giveaway.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete &ldquo;{giveaway.title}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2">
              <span className="block">
                This permanently removes the giveaway and all of its entries.
              </span>
              <span className="block text-amber-400/90">
                Coins already credited to a winner are <span className="font-semibold">not</span> clawed back.
              </span>
              <span className="block text-muted-foreground">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-${giveaway.id}`}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`button-confirm-delete-${giveaway.id}`}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
