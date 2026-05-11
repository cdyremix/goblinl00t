import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { InternalClerkProvider, publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { Dashboard } from "@/pages/dashboard";
import { Giveaways } from "@/pages/giveaways";
import { GiveawayDetail } from "@/pages/giveaway-detail";
import { Stats } from "@/pages/stats";
import { Account } from "@/pages/account";
import SettingsPage from "@/pages/settings";
import TradeOffice from "@/pages/trade-office";
import HelpGuide from "@/pages/help";
import ChatUsers from "@/pages/chat-users";
import Terms from "@/pages/terms";
import Privacy from "@/pages/privacy";
import NotFound from "@/pages/not-found";
import { ErrorBoundary } from "@/components/error-boundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// publishableKeyFromHost resolves from the request hostname in production so
// the same build can serve multiple Clerk custom domains. Falls back to the
// env var when the host doesn't map to a known domain (e.g. localhost in dev).
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// In production, VITE_CLERK_PROXY_URL is auto-set by Replit.
// In dev we leave it undefined — Clerk calls clerk.{riker-domain} directly
// from the user's browser, which can resolve it on the public internet.
const clerkProxyUrl = (import.meta.env.VITE_CLERK_PROXY_URL as string) || undefined;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/goblin-logo.png`,
  },
  variables: {
    colorPrimary: "#f5aa1e",
    colorForeground: "#e8e0d0",
    colorMutedForeground: "#9e9585",
    colorDanger: "#cc2222",
    colorBackground: "#0d0f0e",
    colorInput: "#1d2420",
    colorInputForeground: "#e8e0d0",
    colorNeutral: "#17201d",
    fontFamily: "'Bricolage Grotesque', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#111512] rounded-xl w-[440px] max-w-full overflow-hidden border border-[#17201d] shadow-[0_0_40px_rgba(0,0,0,0.6)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#e8e0d0] font-bold",
    headerSubtitle: "text-[#9e9585]",
    socialButtonsBlockButtonText: "text-[#e8e0d0] font-medium",
    formFieldLabel: "text-[#9e9585] text-sm",
    footerActionLink: "text-[#f5aa1e] hover:text-[#f5c848]",
    footerActionText: "text-[#9e9585]",
    dividerText: "text-[#9e9585]",
    identityPreviewEditButton: "text-[#f5aa1e]",
    formFieldSuccessText: "text-green-400",
    alertText: "text-[#e8e0d0]",
    logoBox: "flex justify-center py-2",
    logoImage: "w-14 h-14 object-contain",
    socialButtonsBlockButton: "border-[#2a3530] bg-[#1a221e] hover:bg-[#222e28] text-[#e8e0d0]",
    formButtonPrimary: "bg-[#f5aa1e] hover:bg-[#f5c040] text-black font-bold",
    formFieldInput: "bg-[#1d2420] border-[#2a3530] text-[#e8e0d0]",
    footerAction: "bg-[#0d0f0e]",
    dividerLine: "bg-[#2a3530]",
    alert: "border-[#2a3530] bg-[#1a221e]",
    otpCodeFieldInput: "bg-[#1d2420] border-[#2a3530] text-[#e8e0d0]",
    formFieldRow: "",
    main: "",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const uid = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== uid) {
        qc.clear();
      }
      prevUserIdRef.current = uid;
    });
    return unsub;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Home />;
  if (isSignedIn) return <Redirect to="/dashboard" />;
  return <Home />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function AuthLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <img src={`${basePath}/goblin-logo.png`} alt="Goblin" className="w-16 h-16 animate-bounce opacity-70" />
        <p className="text-muted-foreground text-sm font-medieval">Summoning the goblin…</p>
      </div>
    </div>
  );
}

function SignInPage() {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoader />;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 dark">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function SignUpPage() {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoader />;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 dark">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard">
        <ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>
      </Route>
      <Route path="/giveaway">
        <ProtectedRoute><Layout><Giveaways /></Layout></ProtectedRoute>
      </Route>
      <Route path="/giveaway/:id">
        <ProtectedRoute><Layout><GiveawayDetail /></Layout></ProtectedRoute>
      </Route>
      <Route path="/stats">
        <ProtectedRoute><Layout><Stats /></Layout></ProtectedRoute>
      </Route>
      <Route path="/commands">
        <Redirect to="/settings" />
      </Route>
      <Route path="/account">
        <ProtectedRoute><Layout><Account /></Layout></ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>
      </Route>
      <Route path="/trade-office">
        <ProtectedRoute><Layout><TradeOffice /></Layout></ProtectedRoute>
      </Route>
      <Route path="/users">
        <ProtectedRoute><Layout><ChatUsers /></Layout></ProtectedRoute>
      </Route>
      <Route path="/help">
        <ProtectedRoute><Layout><HelpGuide /></Layout></ProtectedRoute>
      </Route>
      {/* Public marketing/legal routes — accessible without sign-in so the
          footer links and SEO landing actually work for first-time visitors. */}
      {/* Pricing lives on the public homepage now (#pricing anchor) — the
          standalone /pricing route was removed. Old links redirect home. */}
      <Route path="/pricing">
        <Redirect to="/#pricing" />
      </Route>
      <Route path="/terms">
        <Layout><Terms /></Layout>
      </Route>
      <Route path="/privacy">
        <Layout><Privacy /></Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <InternalClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      __internal_clerkJSUrl={`${window.location.origin}${basePath}/clerk.browser.js`}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back, Goblin",
            subtitle: "Sign in to enter the cave",
          },
        },
        signUp: {
          start: {
            title: "Join the Horde",
            subtitle: "Create your goblin account to get started",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRouter />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </InternalClerkProvider>
  );
}

function App() {
  return (
    // Wrap the whole tree so a render error in any page (or a flaky third-
    // party hook) shows the friendly Reload screen instead of a white tab.
    <ErrorBoundary>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ErrorBoundary>
  );
}

export default App;
