/**
 * Session context: who is signed in, which language they read, and whether the
 * device currently has a network.
 *
 * The token is kept in localStorage because the deployment is a plant LAN with
 * no identity provider — see convex/auth.ts for why. Everything else about the
 * session is fetched fresh; nothing about the user's role is trusted from
 * storage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchProfile,
  signIn as apiSignIn,
  signInWithGoogle as apiSignInWithGoogle,
  signOut as apiSignOut,
  signUp as apiSignUp,
  updateProfile as apiUpdateProfile,
  type Profile,
  type Session,
} from "./api";
import { SELECTABLE_LOCALES, ui, type UiKey } from "./i18n";
import type { Locale } from "./types";

const TOKEN_KEY = "kavach.token";
const LOCALE_KEY = "kavach.locale";

export interface SessionContextValue {
  /** Null until the initial token check has resolved. */
  profile: Profile | null;
  token: string | null;
  /** True only during the very first load, so pages don't flash signed-out. */
  booting: boolean;
  backendReachable: boolean;

  locale: Locale;
  setLocale: (locale: Locale) => void;

  signIn: (email: string, password: string) => Promise<string | null>;
  /** Verify a Google ID token and adopt the session it identifies. */
  signInWithGoogle: (idToken: string) => Promise<string | null>;
  signUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<string | null>;
  signOut: () => Promise<void>;
  updateName: (name: string) => Promise<void>;

  /** Refresh the profile after a server-side change (e.g. role, locale). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
    if (stored && (stored === "en" || stored === "hi" || stored === "sat")) return stored;
  } catch {
    // fall through to the browser default
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
  return nav.startsWith("hi") ? "hi" : "en";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [backendReachable, setBackendReachable] = useState(true);
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  const refresh = useCallback(async () => {
    const current = readToken();
    setToken(current);
    if (!current) {
      setProfile(null);
      setBooting(false);
      return;
    }
    const result = await fetchProfile(current);
    setBackendReachable(result.ok);
    if (!result.ok) {
      // The backend is unreachable, not the session invalid. Keep the token —
      // a trainee in a dead zone must not be signed out — and leave the
      // profile null so protected routes show an offline notice instead.
      setProfile(null);
    } else {
      setProfile(result.value);
      if (result.value?.preferredLocale) {
        const pref = result.value.preferredLocale as Locale;
        if (SELECTABLE_LOCALES.includes(pref)) setLocaleState(pref);
      }
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // non-fatal
    }
    const current = readToken();
    // Only shipped locales are persisted; `sat` is a reserved slot with no
    // content yet, so sending it would be a value the server cannot store.
    if (current && (next === "en" || next === "hi")) {
      void apiUpdateProfile(current, { preferredLocale: next });
    }
  }, []);

  /**
   * Become the profile a successful sign-in identified.
   *
   * All three doors end here, so none of them can drift on what "signed in"
   * means locally — a half-adopted session is the kind of bug that only shows
   * up on a second device.
   */
  const adopt = useCallback((session: Session) => {
    localStorage.setItem(TOKEN_KEY, session.token);
    setToken(session.token);
    setProfile(session.profile);
    setBackendReachable(true);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await apiSignIn({ email, password });
      if (!result.ok) return result.error;
      adopt(result.value);
      return null;
    },
    [adopt],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const result = await apiSignUp({ name, email, password });
      if (!result.ok) return result.error;
      adopt(result.value);
      return null;
    },
    [adopt],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string) => {
      const result = await apiSignInWithGoogle(idToken);
      if (!result.ok) return result.error;
      adopt(result.value);
      return null;
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    const current = readToken();
    if (current) await apiSignOut(current);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // non-fatal
    }
    setToken(null);
    setProfile(null);
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      const current = readToken();
      if (!current) return;
      const result = await apiUpdateProfile(current, { name });
      if (result.ok) setProfile(result.value);
    },
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      profile,
      token,
      booting,
      backendReachable,
      locale,
      setLocale,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      updateName,
      refresh,
    }),
    [
      profile,
      token,
      booting,
      backendReachable,
      locale,
      setLocale,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      updateName,
      refresh,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/**
 * Locale-aware UI string lookup.
 *
 * Returns a stable function per locale, so it is safe in a dependency array
 * and will not re-render consumers on every parent render.
 */
export function useT(): (key: UiKey) => string {
  const { locale } = useSession();
  return useMemo(() => (key: UiKey) => ui(key, locale), [locale]);
}
