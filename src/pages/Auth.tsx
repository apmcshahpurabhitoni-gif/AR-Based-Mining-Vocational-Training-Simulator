/**
 * Sign in / create account.
 *
 * One screen with two modes rather than two routes, because a trainee who lands
 * here to sign in should not have to guess which link is which. The intended
 * destination survives the round trip in `returnTo`.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSession, useT } from "../lib/session";
import { GOOGLE_CLIENT_ID } from "../lib/api";
import { Button } from "../components/ui";
import { LOCALE_LABELS, SELECTABLE_LOCALES } from "../lib/i18n";
import type { Locale } from "../lib/types";

type Mode = "signin" | "register";

/**
 * Google's Identity Services script.
 *
 * This is the one place the app reaches a third-party origin at runtime, and it
 * is a deliberate exception to the self-host-everything rule: an OAuth redirect
 * to Google cannot be self-hosted. The alternative — hand-rolling the
 * authorisation-code flow — buys nothing here, because the trainee's browser
 * has to talk to Google either way.
 *
 * On a genuinely no-egress plant LAN this script simply fails to load, the
 * button never renders, and email + password carries the whole deployment. That
 * is the supported offline path, not a degraded one.
 */
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let googleScript: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (googleScript) return googleScript;
  googleScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_SCRIPT_SRC}"]`,
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script could not be loaded."));
    document.head.appendChild(script);
  });
  return googleScript;
}

interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

/**
 * The official Google button.
 *
 * Google's own widget is used rather than a hand-drawn one: it carries the
 * branding Google requires, and it renders inside an iframe we cannot inspect,
 * which means there is no way for the app to misread a credential it did not
 * verify. The token it hands back is checked server-side regardless.
 */
function GoogleSignInButton({
  context,
  onCredential,
  onError,
}: {
  context: Mode;
  onCredential: (idToken: string) => void;
  onError: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  // Held in refs so a parent re-render does not tear down and re-create the
  // iframe Google renders into.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    // Captured locally: the imported binding is not narrowed inside the async
    // callbacks below, where the value is actually used.
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        const id = window.google?.accounts?.id;
        if (cancelled || !id || !host.current) return;

        id.initialize({
          client_id: clientId,
          callback: (response) => handlers.current.onCredential(response.credential),
        });

        id.renderButton(host.current, {
          type: "standard",
          // White on the dark panel. `filled_black` disappears into the ink
          // background, and this button needs to read as the primary action.
          theme: "outline",
          size: "large",
          text: "continue_with",
          // `button` suppresses One Tap, which would otherwise appear
          // unprompted over a trainee who just wanted to type a password.
          display: "button",
          context,
          logo_alignment: "left",
          width: Math.max(200, Math.min(400, host.current.clientWidth || 360)),
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onError();
      });

    return () => {
      cancelled = true;
    };
  }, [context]);

  if (!GOOGLE_CLIENT_ID) return null;
  return <div ref={host} className="flex justify-center" />;
}

export function Auth() {
  const t = useT();
  const { profile, signIn, signInWithGoogle, signUp } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const returnTo = params.get("returnTo") ?? "/dashboard";
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const googleEnabled = GOOGLE_CLIENT_ID !== null;

  if (profile) return <Navigate to={returnTo} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const result =
      mode === "signin"
        ? await signIn(email, password)
        : await signUp(name, email, password);

    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    navigate(returnTo, { replace: true });
  }

  const completeGoogle = useCallback(
    async (idToken: string) => {
      setError(null);
      setBusy(true);
      const result = await signInWithGoogle(idToken);
      setBusy(false);
      if (result) {
        setError(result);
        return;
      }
      navigate(returnTo, { replace: true });
    },
    [signInWithGoogle, navigate, returnTo],
  );

  const googleFailed = useCallback(() => setError(t("auth.google.failed")), [t]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* -- Form ----------------------------------------------------------- */}
      <div className="flex flex-col px-5 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-amber-400 text-ink-950">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <span className="font-mono text-sm font-bold tracking-[0.2em] text-fog-50">KAVACH</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-fog-600 hover:text-fog-200"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Link>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm">
            <div className="mb-8 inline-flex rounded-lg border border-ink-600 bg-ink-800 p-0.5">
              {(["signin", "register"] as Mode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setError(null);
                  }}
                  aria-pressed={mode === option}
                  className={`rounded-md px-4 py-2 text-sm transition-colors ${
                    mode === option ? "bg-amber-400 text-ink-950" : "text-fog-400 hover:text-fog-50"
                  }`}
                >
                  {option === "signin" ? t("common.signIn") : t("common.createAccount")}
                </button>
              ))}
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-fog-50">
              {mode === "signin" ? t("auth.signIn.title") : t("auth.register.title")}
            </h1>
            <p className="mt-2 text-sm text-fog-400">
              {mode === "signin" ? t("auth.signIn.subtitle") : t("auth.register.subtitle")}
            </p>

            {googleEnabled && (
              <div className="mt-8">
                <GoogleSignInButton
                  context={mode}
                  onCredential={(idToken) => void completeGoogle(idToken)}
                  onError={googleFailed}
                />
                <div className="my-6 flex items-center gap-3">
                  <span className="h-px flex-1 bg-ink-700" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog-700">
                    {t("auth.google.divider")}
                  </span>
                  <span className="h-px flex-1 bg-ink-700" />
                </div>
              </div>
            )}

            <form onSubmit={submit} className={googleEnabled ? "space-y-4" : "mt-8 space-y-4"}>
              {mode === "register" && (
                <Field
                  label={t("auth.name")}
                  value={name}
                  onChange={(v) => setName(v)}
                  type="text"
                  autoComplete="name"
                  required
                />
              )}
              <Field
                label={t("auth.email")}
                value={email}
                onChange={(v) => setEmail(v)}
                type="email"
                autoComplete="email"
                required
              />
              <Field
                label={t("auth.password")}
                value={password}
                onChange={(v) => setPassword(v)}
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 8 : undefined}
                hint={mode === "register" ? "At least 8 characters." : undefined}
              />

              {mode === "register" && (
                <p className="flex gap-2 rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs leading-relaxed text-fog-600">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  {t("auth.adminNotice")}
                </p>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-halt-400/40 bg-halt-400/10 px-3.5 py-2.5 text-sm text-halt-300"
                >
                  {error}
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy
                  ? t("common.loading")
                  : mode === "signin"
                    ? t("common.signIn")
                    : t("common.createAccount")}
              </Button>
            </form>

            <p className="mt-6 text-sm text-fog-600">
              {mode === "signin" ? t("auth.needAccount") : t("auth.haveAccount")}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signin" ? "register" : "signin");
                  setError(null);
                }}
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                {mode === "signin" ? t("common.createAccount") : t("common.signIn")}
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* -- Reassurance ---------------------------------------------------- */}
      <div className="relative hidden overflow-hidden border-l border-ink-700 bg-ink-900 lg:block">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div
          className="absolute -right-24 top-1/3 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #f5920a, transparent)" }}
          aria-hidden="true"
        />
        <div className="relative flex h-full flex-col justify-center px-14">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400">
            Offline-first by construction
          </p>
          <h2 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight text-fog-50">
            Your progress lives on this device first.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-fog-400">
            Every attempt is written locally the moment you answer it, then uploaded when
            there is a network. A mine floor with no signal costs you nothing — and a
            reconnect cannot double-count a single answer.
          </p>

          <dl className="mt-10 grid max-w-md gap-px overflow-hidden rounded-xl border border-ink-700 bg-ink-700">
            {[
              ["Language", "English · हिन्दी"],
              ["Device", "Any modern phone browser"],
              ["Hardware", "None required"],
              ["Connectivity", "Optional, always"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between bg-ink-850 px-4 py-3">
                <dt className="font-mono text-[11px] uppercase tracking-wider text-fog-600">
                  {label}
                </dt>
                <dd className="text-sm text-fog-200">{value}</dd>
              </div>
            ))}
          </dl>

          <LocaleLegend />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  onChange,
  ...input
}: {
  label: string;
  hint?: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-fog-600">
        {label}
      </span>
      <input
        {...input}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-ink-600 bg-ink-850 px-3.5 text-sm text-fog-50 placeholder:text-fog-800 focus:border-amber-400/60 focus:outline-none"
      />
      {hint && <span className="mt-1 block text-xs text-fog-800">{hint}</span>}
    </label>
  );
}

function LocaleLegend() {
  return (
    <ul className="mt-8 flex flex-wrap gap-2">
      {SELECTABLE_LOCALES.map((locale) => (
        <li
          key={locale}
          className="rounded-full border border-ink-700 bg-ink-850 px-3 py-1 font-mono text-[11px] text-fog-400"
        >
          {locale} — {LOCALE_LABELS[locale as Locale]}
        </li>
      ))}
      <li className="rounded-full border border-dashed border-ink-700 px-3 py-1 font-mono text-[11px] text-fog-800">
        sat — reserved, unfilled
      </li>
    </ul>
  );
}
