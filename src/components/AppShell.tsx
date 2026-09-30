/**
 * App shell: the frame every signed-in screen sits inside.
 *
 * Carries the four things a trainee needs to see at all times: who they are,
 * which language, whether the device is actually online, and whether there is
 * unsynced telemetry waiting. Everything else is page-level.
 */

import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import {
  Activity,
  Award,
  LayoutGrid,
  LogOut,
  ShieldCheck,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { useSyncQueue } from "../lib/sync";
import { LOCALE_LABELS, SELECTABLE_LOCALES } from "../lib/i18n";
import { Chip } from "./ui";
import type { Locale } from "../lib/types";

export function AppShell() {
  const { profile, token, locale, setLocale, signOut } = useSession();
  const t = useT();
  const navigate = useNavigate();
  const queue = useSyncQueue(token);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const isSupervisor = profile?.role === "admin" || profile?.role === "supervisor";

  /** Routes that render a 3D surface rather than a document. */
  const isTrainingSurface =
    pathname.startsWith("/training") || pathname.startsWith("/recheck");

  const navItems = [
    { to: "/dashboard", label: t("nav.dashboard"), icon: LayoutGrid, show: true },
    { to: "/certificate", label: t("nav.certificate"), icon: Award, show: true },
    { to: "/admin", label: t("nav.admin"), icon: Activity, show: isSupervisor },
  ].filter((item) => item.show);

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      {/* Hazard tape: a thin, permanent reminder that this is a safety app. */}
      <div className="hazard-tape h-1 w-full shrink-0 opacity-70" aria-hidden="true" />

      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <NavLink to="/dashboard" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-amber-400 text-ink-950">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <span className="leading-none">
              <span className="block font-mono text-sm font-bold tracking-[0.2em] text-fog-50">
                KAVACH
              </span>
              <span className="hidden text-[11px] text-fog-600 sm:block">{t("app.tagline")}</span>
            </span>
          </NavLink>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-ink-800 text-amber-300"
                      : "text-fog-400 hover:bg-ink-800/60 hover:text-fog-50",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ConnectivityChip queue={queue} />

            <LocaleSwitch locale={locale} onChange={setLocale} />

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-9 w-9 place-items-center rounded-full border border-ink-600 bg-ink-800 font-mono text-xs font-semibold text-amber-300"
                aria-label="Account menu"
                aria-expanded={menuOpen}
              >
                {(profile?.name ?? "?").slice(0, 2).toUpperCase()}
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="panel absolute right-0 z-20 mt-2 w-60 overflow-hidden p-1 shadow-2xl">
                    <div className="border-b border-ink-700 px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-fog-50">
                        {profile?.name ?? "Signed in"}
                      </p>
                      <p className="truncate font-mono text-[11px] text-fog-600">
                        {profile?.workerCode ?? profile?.email}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-fog-600">
                        {profile?.orgName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-fog-200 hover:bg-ink-800"
                    >
                      <LogOut className="h-4 w-4" />
                      {t("nav.signOut")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/*
       * The training surfaces get a much wider container than the rest of the
       * app. A 1152 px reading measure is right for text and wrong for a room you
       * are meant to look around inside: capped at that width the 3D view renders
       * as a letterbox with the equipment squeezed into the middle of it. The
       * other pages keep the narrow measure, because they are documents.
       */}
      <main
        className={clsx(
          "mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-10",
          isTrainingSurface ? "max-w-[110rem]" : "max-w-6xl",
        )}
      >
        <Outlet />
      </main>

      {/* Mobile nav, because a trainee on a phone is the primary case. */}
      <nav className="sticky bottom-0 z-30 border-t border-ink-700 bg-ink-950/95 backdrop-blur md:hidden">
        <div className="flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]",
                  isActive ? "text-amber-300" : "text-fog-600",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function ConnectivityChip({
  queue,
}: {
  queue: ReturnType<typeof useSyncQueue>;
}) {
  const online = queue.pending === 0 && !queue.syncing;
  const tone = queue.syncing
    ? "amber"
    : queue.pending > 0
      ? "warn"
      : online
        ? "go"
        : "halt";

  return (
    <Chip tone={tone} className="hidden sm:inline-flex">
      {queue.syncing ? (
        <>
          <Wifi className="h-3 w-3" />
          {queue.pending}
        </>
      ) : queue.pending > 0 ? (
        <>
          <WifiOff className="h-3 w-3" />
          {queue.pending}
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          synced
        </>
      )}
    </Chip>
  );
}

function LocaleSwitch({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div className="flex rounded-lg border border-ink-600 bg-ink-800 p-0.5">
      {SELECTABLE_LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={locale === option}
          className={clsx(
            "rounded-md px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
            locale === option
              ? "bg-amber-400 text-ink-950"
              : "text-fog-400 hover:text-fog-50",
          )}
          title={LOCALE_LABELS[option]}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * Shown when the backend is unreachable. Not an error state — the app works
 * offline by design, so this is context, not a failure.
 */
export function OfflineNotice({ queued }: { queued: number }) {
  const t = useT();
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-warn-400/30 bg-warn-400/5 p-4">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-400" />
      <div className="text-sm">
        <p className="font-medium text-warn-400">Backend unreachable</p>
        <p className="mt-0.5 text-fog-400">
          Training continues normally and your progress is saved on this device.
          {queued > 0 && ` ${queued} attempt${queued === 1 ? "" : "s"} waiting to sync.`}
        </p>
        <p className="mt-1.5 text-xs text-fog-600">{t("training.queueSaved")}</p>
      </div>
    </div>
  );
}
