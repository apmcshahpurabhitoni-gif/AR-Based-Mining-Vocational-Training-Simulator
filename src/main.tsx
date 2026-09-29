/**
 * Entry point.
 *
 * The provider tree is deliberately shallow: SessionProvider and the router.
 * Convex is reached over HTTP from `lib/api.ts` rather than through a reactive
 * client, because the app must render and train correctly with the backend
 * unreachable — a reactive query provider would make the whole tree wait on a
 * connection that may never arrive.
 *
 * The error boundary below is not decoration. A render crash inside a lazy
 * route unmounts the whole tree, and a dark-themed app that unmounts looks
 * exactly like an app that never loaded: blank, silent, indistinguishable from
 * a broken server. It happened twice during development before this existed.
 * Anything thrown during render now says what it was, on screen.
 */

import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { SessionProvider } from "./lib/session";

/**
 * Last line of defence.
 *
 * Deliberately plain and deliberately loud. The goal is not a pretty error
 * screen — it is that a blank page is never the final answer, because a blank
 * page cannot be diagnosed.
 */
class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console as well, with the component stack, for anyone with
    // devtools open.
    console.error("KAVACH failed to render:", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-dvh bg-ink-950 px-5 py-10 text-fog-50">
        <div className="mx-auto max-w-lg rounded-xl border border-halt-400/40 bg-ink-900 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-halt-300">
            Something went wrong
          </p>
          <h1 className="mt-3 text-xl font-semibold">This screen failed to load.</h1>
          <p className="mt-3 text-sm leading-relaxed text-fog-400">
            Nothing you have done so far was lost. Training attempts are stored on this
            device before they are uploaded, so reloading is safe.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs leading-relaxed text-amber-200">
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-ink-950"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
