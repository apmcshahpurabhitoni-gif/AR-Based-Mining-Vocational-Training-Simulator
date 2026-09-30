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
import {
  clearCachedProfile as clearCache,
  readCachedProfile as readCache,
  writeCachedProfile as writeCache,
} from "./profile-cache";
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
  /**
   * True when `profile` came from this device rather than from the server.
   *
   * It is a cached copy, last written when the server answered. It exists so
   * the app is usable underground, and it is display-only: it is never trusted
   * for an authorisation decision, because a value a trainee can edit in
   * localStorage cannot be evidence of anything. Every call the server owns
   * still goes to the server.
   */
  profileStale: boolean;

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

/**
 * The last profile the server confirmed, kept so the app can be opened with
 * no network. See `profile-cache.ts` for why this exists and what it is not.
 */
function readCachedProfile(): Profile | null {
  return readCache(typeof localStorage === "undefined" ? null : localStorage);
}

function writeCachedProfile(profile: Profile): void {
  writeCache(typeof localStorage === "undefined" ? null : localStorage, profile);
}

function clearCachedProfile(): void {
  clearCache(typeof localStorage === "undefined" ? null : localStorage);
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
  const [profileStale, setProfileStale] = useState(false);
  const [booting, setBooting] = useState(true);
  const [backendReachable, setBackendReachable] = useState(true);
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  const refresh = useCallback(async () => {
    const current = readToken();
    setToken(current);
    if (!current) {
      setProfile(null);
      setProfileStale(false);
      setBooting(false);
      return;
    }
    const result = await fetchProfile(current);
    setBackendReachable(result.ok);

    if (!result.ok) {
      /*
       * The backend is unreachable, NOT the session invalid. Two different
       * things, and conflating them is what made this app unusable in the one
       * situation it is built for.
       *
       * `RequireAuth` sends anyone without a profile to the sign-in page, so
       * leaving `profile` null here meant a trainee who lost signal underground
       * was bounced to a password prompt and could not reach training, the
       * dashboard, or their own results — with a whole local-first database,
       * event queue and local assessment sitting unused on their handset. The
       * offline path could not be taken because the app never let anyone onto
       * it.
       *
       * So: keep the token, and fall back to the copy of the profile this
       * device already has. It is display-only and marked stale. The server
       * still decides every call it owns.
       */
      const cached = readCachedProfile();
      setProfile(cached);
      setProfileStale(cached !== null);
    } else {
      setProfileStale(false);
      setProfile(result.value);
      if (result.value) {
        writeCachedProfile(result.value);
        if (result.value.preferredLocale) {
          const pref = result.value.preferredLocale as Locale;
          if (SELECTABLE_LOCALES.includes(pref)) setLocaleState(pref);
        }
      } else {
        // The server answered and said this token is not valid. That is a real
        // sign-out, unlike a network failure, so the cached identity goes too.
        clearCachedProfile();
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
    setProfileStale(false);
    writeCachedProfile(session.profile);
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
    // The cached identity goes with the token. Leaving it behind would let the
    // next person to pick up the handset into a signed-in shell.
    clearCachedProfile();
    setToken(null);
    setProfile(null);
    setProfileStale(false);
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      const current = readToken();
      if (!current) return;
      const result = await apiUpdateProfile(current, { name });
      // A successful call that returns no profile is not a successful rename;
      // writing `null` to the cache would lock the next offline load out of
      // its own app.
      if (result.ok && result.value) {
        setProfile(result.value);
        writeCachedProfile(result.value);
      }
    },
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      profile,
      token,
      booting,
      backendReachable,
      profileStale,
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
      profileStale,
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
