import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

// Layout
import { Layout } from "@/components/layout";

// Pages
import { Home } from "@/pages/home";
import { Dashboard } from "@/pages/dashboard";
import { Giveaways } from "@/pages/giveaways";
import { GiveawayDetail } from "@/pages/giveaway-detail";
import { Stats } from "@/pages/stats";
import { Commands } from "@/pages/commands";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/giveaway">
        <Layout><Giveaways /></Layout>
      </Route>
      <Route path="/giveaway/:id">
        <Layout><GiveawayDetail /></Layout>
      </Route>
      <Route path="/stats">
        <Layout><Stats /></Layout>
      </Route>
      <Route path="/commands">
        <Layout><Commands /></Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
