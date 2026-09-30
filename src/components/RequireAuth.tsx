/**
 * Route guard.
 *
 * Signed-out visitors are sent to `/auth` with the path they were trying to
 * reach in `returnTo`, so signing in drops them exactly where they intended
 * rather than on the landing page. That is the difference between a product
 * that feels like an application and one that feels like a brochure.
 *
 * The one thing it does NOT do is sign anyone out when the backend is merely
 * unreachable. Offline is a supported state here; losing a trainee's session
 * because a mine's Wi-Fi dropped would be a serious defect.
 *
 * That sentence used to be a claim rather than a description. This guard
 * redirects on `!profile`, and the session provider set `profile` to null
 * whenever the server could not be reached — so it redirected on exactly the
 * case it claimed to be tolerant of, and the offline path was unreachable: no
 * training, no dashboard, no results, on a device that had a complete local
 * store sitting there unused. The provider now falls back to the profile this
 * device already has, so `profile` is null only when there is genuinely no
 * identity to show: no token, or a token the server has rejected.
 *
 * The guard stays a guard. It is a user-experience redirect, not an
 * authorisation boundary — nothing it does grants access to anything, because
 * every call the server owns is still made by the server.
 */

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSession } from "../lib/session";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { profile, booting } = useSession();
  const location = useLocation();

  if (booting) return <BootScreen />;

  /*
   * One condition, not two. A token with no profile means this device holds an
   * identity it cannot show, and inventing one would be worse than asking; a
   * missing profile already covers that, so branching on the token as well
   * would only create two conditions that can disagree.
   */
  if (!profile) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

/** Keeps the flash of signed-out content from appearing during the token check. */
export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950">
      <div className="flex flex-col items-center gap-4">
        <div className="relative grid h-12 w-12 place-items-center">
          <span className="absolute inset-0 rounded-xl border-2 border-amber-400 animate-pulse-ring" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-fog-600">KAVACH</p>
      </div>
    </div>
  );
}
