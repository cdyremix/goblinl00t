import React from "react";

interface State {
  err: Error | null;
}

/**
 * Top-level render-error boundary. Without this, an uncaught render exception
 * anywhere in the tree turns the whole dashboard into a white screen — no
 * stack, no recovery path, just a confused streamer with a stream running.
 *
 * We deliberately keep this dead-simple: show the error message, offer a
 * Reload button, and log to the console. No telemetry, no Sentry, no fancy
 * fallback UI. Streamer hits Reload and they're back.
 *
 * NOTE: this catches *render* errors. It does NOT catch event handler
 * errors, async errors, or errors thrown from useEffect — those still bubble
 * out as unhandled promise rejections. React Query's per-query error states
 * cover most of the async story.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-lg w-full bg-card border border-destructive/40 rounded-xl p-6 space-y-4 shadow-[0_0_60px_rgba(204,34,34,0.15)]">
          <div className="flex items-center gap-3">
            <div className="text-3xl">💥</div>
            <div>
              <h1 className="text-xl font-bold">The goblin tripped over a wire</h1>
              <p className="text-sm text-muted-foreground">Something broke while rendering this page.</p>
            </div>
          </div>
          <pre className="bg-background border border-border rounded p-3 text-xs text-destructive overflow-auto max-h-40 whitespace-pre-wrap">
            {this.state.err.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-bold hover:brightness-110"
              data-testid="button-error-reload"
            >
              Reload
            </button>
            <a
              href="/help"
              className="border border-border px-4 py-2 rounded-md font-medium hover:bg-muted/40"
            >
              Help &amp; Guide
            </a>
          </div>
        </div>
      </div>
    );
  }
}
