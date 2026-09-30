/**
 * The build status, on every screen.
 *
 * ---------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------
 *
 * This build is being handed to people outside the team, on a phone, as an
 * installable file. An installable file is a *more* credible-looking artefact
 * than a URL, which is the problem: a trainee holding an app with a certificate
 * in its name and no status line has no way to tell a working build from a
 * finished product, and the finished product does not exist yet.
 *
 * So it is stated, in both shipped languages, permanently, and it is not
 * dismissible. A warning a trainee can swipe away is a warning that will be
 * swiped away before the assessment that depends on it — which is the same
 * reasoning as the hazard tape above it in the app shell, and the pre-pilot
 * disclosure on the landing page.
 *
 * It says *may not work*, never *is unsafe*. Those are different claims and
 * only the first one is true: the gate fails closed, no certificate is issued
 * for anyone today, and the thing that is unfinished here is the software, not
 * the safety case.
 */

import { Hammer } from "lucide-react";
import { useT } from "../lib/session";
import { clsx } from "clsx";

/**
 * The one-line strip, for the top of the app shell.
 *
 * One line on purpose. It sits above every signed-in page including the 3D
 * training surface, so it has to cost a trainee nothing to read past.
 */
export function BuildNoticeBar({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      // Announced once on load rather than on every navigation: a live region
      // that fires on every route change is noise, and a screen-reader user
      // needs to know the state once, not thirty times.
      role="status"
      className={clsx(
        "flex items-center justify-center gap-2 border-b border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-center",
        className,
      )}
    >
      <Hammer className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="font-mono text-[10px] uppercase leading-tight tracking-[0.14em] text-amber-200/90 sm:text-[11px]">
        {t("app.buildNotice")}
      </p>
    </div>
  );
}

/**
 * The fuller card, for the landing page, where there is room to say what the
 * strip means and what to do about it.
 */
export function BuildNoticeCard() {
  const t = useT();
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
        <Hammer className="h-4 w-4" />
        {t("app.buildNotice")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fog-300">
        {t("app.buildNotice.detail")}
      </p>
    </div>
  );
}
