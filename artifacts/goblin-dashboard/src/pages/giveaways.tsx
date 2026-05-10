import { useListGiveaways, useCreateGiveaway, getListGiveawaysQueryKey, useGetCurrentGiveaway } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Trophy, ChevronRight, Clock, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  prize: z.string().min(1, "Prize is required"),
  keyword: z.string().min(1, "Keyword is required").regex(/^\w+$/, "Must be a single word (no spaces)"),
  maxEntries: z.coerce.number().min(1).optional().or(z.literal("")),
  description: z.string().optional(),
});

export function Giveaways() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  
  const { data: giveaways, isLoading } = useListGiveaways();
  const { data: currentGiveaway } = useGetCurrentGiveaway();
  
  const createMutation = useCreateGiveaway();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      prize: "",
      keyword: "loot",
      maxEntries: undefined,
      description: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createMutation.mutate(
      {
        data: {
          ...values,
          maxEntries: values.maxEntries === "" ? undefined : values.maxEntries as number,
        }
      },
      {
        onSuccess: () => {
          toast({
            title: "Giveaway created",
            description: "Ready to be started from the hoard list.",
          });
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
        },
        onError: () => {
          toast({
            title: "Failed to create",
            description: "The goblin refused. Try again.",
            variant: "destructive",
          });
        }
      }
    );
  }

  const filteredGiveaways = giveaways?.filter(g => {
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
                  <FormField
                    control={form.control}
                    name="prize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prize</FormLabel>
                        <FormControl>
                          <Input placeholder="10,000 Gold" {...field} className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
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
                      name="maxEntries"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Winners</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="1" {...field} className="bg-background" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
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
                const isEnded = giveaway.status === "ended";
                const isCurrent = currentGiveaway?.giveaway?.id === giveaway.id;

                return (
                  <Link key={giveaway.id} href={`/giveaway/${giveaway.id}`}>
                    <Card className={`border-border/50 hover:border-primary/50 transition-all cursor-pointer group ${isActive ? 'bg-primary/5' : 'bg-card/50'}`}>
                      <CardContent className="p-5 flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-lg text-foreground truncate group-hover:text-primary transition-colors">{giveaway.title}</h3>
                            <StatusBadge status={giveaway.status} isCurrent={isCurrent} />
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5" /> {giveaway.prize}</span>
                            <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /> !{giveaway.keyword}</span>
                            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {new Date(giveaway.createdAt).toLocaleDateString()}</span>
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
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
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

function StatusBadge({ status, isCurrent }: { status: string, isCurrent?: boolean }) {
  if (status === "active") return <Badge className="bg-primary/20 text-primary border-primary/30">ACTIVE {isCurrent && "(LIVE)"}</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-muted-foreground border-border">PENDING</Badge>;
  if (status === "ended") return <Badge variant="secondary" className="bg-muted text-muted-foreground">ENDED</Badge>;
  return null;
}
