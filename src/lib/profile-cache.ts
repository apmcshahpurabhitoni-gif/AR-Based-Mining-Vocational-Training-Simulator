/**
 * Cached profile.
 *
 * Why this exists: `RequireAuth` redirects anyone without a profile to the
 * sign-in page, and the session provider used to null the profile whenever the
 * server could not be reached. Those two facts together meant the app's
 * offline path could not be taken at all — a trainee who lost signal
 * underground was bounced to a password prompt and could not reach training,
 * the dashboard, or their own results, on a device holding a complete local
 * store, event queue and local assessment. Offline was a supported state that
 * the app refused to enter.
 *
 * So the last profile the server confirmed is kept here, and used for display
 * when the server cannot be asked.
 *
 * What it is NOT: an identity. Anything running on the device can write it, so
 * it is never trusted for an authorisation decision, and it is shape-checked
 * on read rather than cast — a value that is not a well-formed profile is
 * discarded instead of being spread through the UI as if it were real. The
 * server still decides every call it owns.
 */

import type { Profile } from "./api";

export const PROFILE_KEY = "kavach.profile";

/** The slice of `Storage` this module needs, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ROLES = ["worker", "supervisor", "admin"] as const;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Read the cached profile, or null if there is none worth trusting.
 *
 * Never throws: storage can be disabled (private mode), full, or hold
 * something another script wrote. A trainee losing their offline app to a
 * corrupt cache would be a worse outcome than showing no name.
 */
export function readCachedProfile(storage: StorageLike | null): Profile | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const p = parsed as Record<string, unknown>;
  const id = str(p.id);
  const name = str(p.name);
  const role = str(p.role);
  // Identity without a name is not displayable, and a role outside the enum is
  // not a role this app knows how to render — in either case, drop it rather
  // than invent a plausible-looking value.
  if (!id || !name) return null;
  if (!role || !(ROLES as readonly string[]).includes(role)) return null;

  return {
    id,
    name,
    email: str(p.email),
    role: role as Profile["role"],
    workerCode: str(p.workerCode),
    orgId: str(p.orgId) ?? "",
    orgName: str(p.orgName) ?? "",
    preferredLocale: str(p.preferredLocale),
  };
}

export function writeCachedProfile(storage: StorageLike | null, profile: Profile): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode, or a full quota. The app still works online.
  }
}

/**
 * Forget the cached identity.
 *
 * Called on sign-out and when the server rejects a token. Leaving it behind
 * would let the next person to pick up the handset into a signed-in shell.
 */
export function clearCachedProfile(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PROFILE_KEY);
  } catch {
    // non-fatal
  }
}
