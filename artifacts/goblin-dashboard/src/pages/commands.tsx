import { useListCommands, useToggleCommand, getListCommandsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Terminal, Clock, Shield } from "lucide-react";

export function Commands() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: commands, isLoading } = useListCommands();
  const toggleMutation = useToggleCommand();

  function handleToggle(name: string, currentEnabled: boolean) {
    toggleMutation.mutate(
      { name },
      {
        onSuccess: (cmd) => {
          toast({
            title: cmd.enabled ? `${name} enabled` : `${name} disabled`,
            description: cmd.enabled ? "Chatters can now use this command." : "Command is now locked.",
          });
          queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey() });
        },
        onError: () => {
          toast({ title: "Toggle failed", description: "The goblin resisted.", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-primary">Spells</h1>
        <p className="text-muted-foreground mt-2 text-lg">Enable or disable the goblin's chat commands.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Command List */}
        <div className="lg:col-span-2">
          <Card className="border-border/50">
            <CardHeader className="border-b border-border/50">
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-primary" />
                Bot Commands
              </CardTitle>
              <CardDescription>Toggle commands to enable or disable them in chat. Changes take effect immediately.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                      <Skeleton className="h-6 w-11 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : commands && commands.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {commands.map((cmd) => (
                    <div
                      key={cmd.name}
                      className={`flex items-center justify-between px-6 py-4 transition-colors ${cmd.enabled ? "hover:bg-muted/20" : "hover:bg-muted/10 opacity-60"}`}
                      data-testid={`row-command-${cmd.name.replace("!", "")}`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-3 mb-1">
                          <code className="font-mono font-bold text-base text-foreground">{cmd.name}</code>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                            <Clock className="w-3 h-3" />
                            {cmd.cooldownSeconds}s
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground leading-snug">{cmd.description}</p>
                      </div>
                      <Switch
                        checked={cmd.enabled}
                        onCheckedChange={() => handleToggle(cmd.name, cmd.enabled)}
                        disabled={toggleMutation.isPending}
                        data-testid={`switch-command-${cmd.name.replace("!", "")}`}
                        aria-label={`Toggle ${cmd.name}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No commands configured.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Info Sidebar */}
        <div className="space-y-4">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="w-5 h-5 text-primary" />
                How Commands Work
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                Each command has a <strong className="text-foreground">cooldown</strong> that prevents a single viewer from spamming. Cooldowns are per-user, per-channel.
              </p>
              <p>
                Disabled commands are <strong className="text-foreground">completely ignored</strong> by the bot — the goblin won't respond at all.
              </p>
              <p>
                Changes take effect <strong className="text-foreground">immediately</strong> without restarting the bot.
              </p>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5">
              <p className="text-sm font-bold text-primary mb-2">Giveaway Tip</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                During a giveaway, make sure the <code className="font-mono text-foreground">!enter</code> command is enabled. You can disable <code className="font-mono text-foreground">!loot</code> during giveaways to keep chat focused.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
