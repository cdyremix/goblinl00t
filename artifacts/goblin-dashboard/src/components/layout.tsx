import { Link, useLocation } from "wouter";
import { LayoutDashboard, Gift, BarChart3, Terminal, Shield, Home } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: "/dashboard", label: "Operations", icon: LayoutDashboard },
    { href: "/giveaway", label: "Loot Hoard", icon: Gift },
    { href: "/stats", label: "Ledger", icon: BarChart3 },
    { href: "/commands", label: "Spells", icon: Terminal },
  ];

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground selection:bg-primary/30 dark">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col backdrop-blur-sm">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Shield className="w-6 h-6 text-primary mr-3" />
          <span className="font-bold text-xl tracking-tight text-primary">Goblin L00t</span>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-2">
          {links.map((link) => {
            const isActive = location.startsWith(link.href);
            const Icon = link.icon;
            
            return (
              <Link 
                key={link.href} 
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(255,180,0,0.1)]" 
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
                }`}
                data-testid={`nav-${link.label.toLowerCase()}`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <Link 
            href="/"
            className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Home className="w-4 h-4" />
            <span className="text-sm">Exit Cave</span>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background relative">
        {/* Subtle noise texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        <div className="relative z-10 p-8 max-w-7xl mx-auto min-h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
