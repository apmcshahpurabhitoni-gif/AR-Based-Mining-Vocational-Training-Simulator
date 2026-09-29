/**
 * Typed client for the KAVACH backend.
 *
 * Every call here is *best effort by design*. The pilot runs on a plant LAN
 * where the backend is frequently unreachable, and a training app that shows a
 * spinner forever because a query timed out is worse than one that runs the
 * session locally and syncs later.
 *
 * So the contract is: call it, get a `Result`, never throw at the call site.
 * Callers decide whether a missing server response is fatal (it is not, for
 * anything in the training flow).
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODULES, MODULE_CODES } from "./modules";
import type { ModuleManifest } from "./types";

/**
 * Where the Convex backend lives, as the *browser* sees it.
 *
 * `VITE_CONVEX_URL` is authoritative: a Convex Cloud URL, or a plant-LAN host.
 *
 * The fallback is the page's own origin, because that is the only address a
 * browser can always reach. The dev server proxies `/convex` through to the
 * local backend, so the request stays same-origin. The previous fallback was a
 * bare `http://127.0.0.1:3210`, which resolves to the *trainee's own machine*
 * the moment the app is opened from anywhere but this sandbox — an unreachable
 * host, and a blocked one, since an HTTPS page cannot fetch plain HTTP.
 */
function resolveBackendUrl(): string {
  const configured = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim();

  // A loopback address only means anything on the machine that runs the
  // backend. When the page is served from anywhere else — which is to say, for
  // every real user — that value resolves to *their* machine, so it cannot
  // work. Prefer the same-origin proxy rather than failing with a bare
  // "Failed to fetch" and no explanation.
  const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
    configured ?? "",
  );
  const servedFromElsewhere =
    typeof window !== "undefined" &&
    !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(window.location.hostname);

  if (configured && !(isLoopback && servedFromElsewhere)) return configured;
  if (typeof window !== "undefined") return `${window.location.origin}/convex`;
  return "http://127.0.0.1:3210";
}

const CONVEX_URL = resolveBackendUrl();

export const BACKEND_URL = CONVEX_URL;
export const BACKEND_LABEL = `${CONVEX_URL.replace(/^https?:\/\//, "")} · local deployment`;

/**
 * Google OAuth client id, or null when the deployment has no Google sign-in.
 *
 * Checked here rather than fetched from the server: the value is public, and a
 * plant LAN that cannot reach the backend should still render a usable sign-in
 * screen rather than waiting on a query that will time out.
 */
export const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null;

let client: ConvexHttpClient | null = null;

function getClient(): ConvexHttpClient {
  if (!client) client = new ConvexHttpClient(CONVEX_URL);
  return client;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Reduce a Convex error to something worth showing a person.
 *
 * Convex wraps anything thrown server-side in a request id and a stack trace.
 * Rendered raw, a trainee on a mine floor reads
 *
 *   [Request ID: 09f7…] Uncaught Error: … at handler (../convex/auth.ts:228)
 *
 * which says nothing about their password and a great deal about our file
 * layout. The request id is not lost — it is on the server log, where support
 * can find it — but it does not belong in the answer to "is my password right".
 */
function cleanErrorMessage(message: string): string {
  return message
    .replace(/^\[Request ID: [^\]]*\]\s*/, "")
    .replace(/^Server Error\s*\n?/i, "")
    .replace(/^(?:Uncaught\s+)?[A-Za-z]*Error:\s*/i, "")
    .split("\n")
    .filter((line) => !/^\s*at\s/.test(line))
    .join(" ")
    .trim();
}

/**
 * Hard ceiling on any single request.
 *
 * A fetch that is opened but never answered — a weak link, a captive portal, a
 * dropped connection that never surfaces as an error — never settles, so the
 * `await` never returns. Without this, the session bootstrap never completes,
 * `booting` stays true, and the app sits on a single pulsing dot on a black
 * screen with no error and no way out. That is a supported-looking dead end,
 * and the failure this file exists to prevent.
 *
 * Timing out is safe because every call here is best effort by design: the
 * offline queue holds the events and pushes them on the next attempt. Long
 * enough not to punish a slow plant link.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "The safety server did not respond in time. You may be offline — everything you have completed is saved on this device.",
          ),
        ),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Turn a transport failure into something a trainee can act on.
 *
 * A browser reports every one of these as the same two words — wrong scheme,
 * CORS, DNS, connection refused, blocked mixed content. "Failed to fetch"
 * tells a person on a mine floor nothing at all, which is the one moment the
 * wording actually matters.
 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `Cannot reach the safety server at ${BACKEND_LABEL}. Check this device's connection and try again.`;
  }
  return cleanErrorMessage(message);
}

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await withTimeout(fn(), REQUEST_TIMEOUT_MS) };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

// ---------------------------------------------------------------------------
// Bundled content
// ---------------------------------------------------------------------------

/**
 * The manifests compiled into the bundle.
 *
 * This is the source of truth for running a module. Fetching from the server
 * is an optimisation that keeps a published edit from needing a redeploy, not a
 * prerequisite — so the app never waits on it to let someone train.
 */
export function bundledManifests(): ModuleManifest[] {
  return MODULE_CODES.map((code) => MODULES[code]!);
}

export async function fetchPublishedModules(): Promise<Result<ModuleManifest[]>> {
  return attempt(() => getClient().query(api.content.listModules, {}));
}

/** Publish the bundled manifests. Called once at startup; idempotent. */
export async function publishBundledModules(): Promise<Result<unknown>> {
  return attempt(() => getClient().mutation(api.content.publishModules, {}));
}

export async function fetchDemoStats() {
  return attempt(() => getClient().query(api.content.demoStats, {}));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  role: "worker" | "supervisor" | "admin";
  workerCode: string | null;
  orgId: string;
  orgName: string;
  preferredLocale: string | null;
}

/** What every sign-in door returns: the token to store, and who it is for. */
export interface Session {
  token: string;
  profile: Profile;
}

/**
 * Unwrap a sign-in mutation into a `Result<Session>`.
 *
 * Every door resolves a profile server-side alongside the token, and the app
 * trusts the profile rather than anything the client holds, so a token that
 * arrives without one is a failure — not a half-signed-in state worth
 * rendering. One guard, three call sites.
 */
async function toSession(
  run: () => Promise<{ token: string; profile: Profile | null }>,
): Promise<Result<Session>> {
  const result = await attempt(run);
  if (!result.ok) return result;
  if (!result.value.profile) {
    return { ok: false, error: "Signed in, but the profile could not be loaded." };
  }
  return { ok: true, value: { token: result.value.token, profile: result.value.profile } };
}

export async function signUp(args: {
  name: string;
  email: string;
  password: string;
  preferredLocale?: string;
}): Promise<Result<Session>> {
  return toSession(() =>
    getClient().mutation(api.auth.register, {
      name: args.name,
      email: args.email,
      password: args.password,
      ...(args.preferredLocale ? { preferredLocale: args.preferredLocale as "en" | "hi" } : {}),
    }),
  );
}

export async function signIn(args: {
  email: string;
  password: string;
}): Promise<Result<Session>> {
  return toSession(() =>
    getClient().mutation(api.auth.login, { email: args.email, password: args.password }),
  );
}

export async function fetchProfile(token: string): Promise<Result<Profile | null>> {
  return attempt(() => getClient().query(api.auth.me, { token }));
}

/**
 * Exchange a verified Google ID token for a KAVACH session.
 *
 * Identical in and out to `signIn`, on purpose: after this resolves, the rest of
 * the app cannot tell which door the user came through.
 */
export async function signInWithGoogle(idToken: string): Promise<Result<Session>> {
  return toSession(() => getClient().mutation(api.auth.googleSignIn, { idToken }));
}

export async function signOut(token: string): Promise<Result<unknown>> {
  return attempt(() => getClient().mutation(api.auth.logout, { token }));
}

export async function updateProfile(
  token: string,
  args: { name?: string; preferredLocale?: "en" | "hi" },
): Promise<Result<Profile | null>> {
  return attempt(() =>
    getClient().mutation(api.auth.updateProfile, { token, ...args }),
  );
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export async function startSession(
  token: string,
  args: {
    moduleCode: string;
    moduleVersion: string;
    locale: string;
    deviceId: string;
    clientSessionId: string;
  },
): Promise<Result<{ sessionId: string; resumed: boolean }>> {
  return attempt(() => getClient().mutation(api.sessions.startSession, { token, ...args }));
}

export async function pushEvents(
  token: string,
  args: { sessionId: string; manifests: ModuleManifest[]; events: unknown[] },
): Promise<Result<{ inserted: number; duplicates: number; rejected: number }>> {
  return attempt(() =>
    getClient().mutation(api.sessions.pushAttempts, {
      token,
      // The generated API types require a document id; the client holds an
      // opaque string that only the server can interpret.
      sessionId: args.sessionId as Id<"sessions">,
      manifests: args.manifests,
      events: args.events,
    }),
  );
}

export async function completeSession(
  token: string,
  args: { sessionId: string; manifest: ModuleManifest },
): Promise<Result<unknown>> {
  return attempt(() =>
    getClient().mutation(api.sessions.completeSession, {
      token,
      sessionId: args.sessionId as Id<"sessions">,
      manifest: args.manifest,
    }),
  );
}

export async function fetchSessions(token: string) {
  return attempt(() => getClient().query(api.sessions.mySessions, { token }));
}

export async function fetchRecheckStatus(token: string) {
  return attempt(() => getClient().query(api.sessions.recheckStatus, { token }));
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export async function fetchAssessment(token: string, manifests: ModuleManifest[]) {
  return attempt(() => getClient().query(api.assessment.myAssessment, { token, manifests }));
}

export async function fetchRecheckSample(token: string, manifests: ModuleManifest[]) {
  return attempt(() => getClient().query(api.assessment.myRecheckSample, { token, manifests }));
}

export async function submitRecheck(
  token: string,
  manifests: ModuleManifest[],
  results: Array<{
    stepId: string;
    moduleCode: string;
    critical: boolean;
    reason: string;
    outcome: "pass" | "fail";
  }>,
) {
  return attempt(() =>
    getClient().mutation(api.assessment.submitRecheck, { token, manifests, results }),
  );
}

export async function issueCertificate(token: string, manifests: ModuleManifest[]) {
  return attempt(() =>
    getClient().mutation(api.assessment.issueCertificate, { token, manifests }),
  );
}

export async function fetchMyCertificates(token: string) {
  return attempt(() => getClient().query(api.assessment.myCertificates, { token }));
}

/** Public verification — deliberately unauthenticated. */
export async function verifyCode(code: string) {
  return attempt(() => getClient().query(api.assessment.verifyCertificate, { code }));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function fetchHeatmap(token: string, manifests: ModuleManifest[]) {
  return attempt(() => getClient().query(api.admin.stepHeatmap, { token, manifests }));
}

export async function fetchRoster(token: string) {
  return attempt(() => getClient().query(api.admin.roster, { token }));
}

export async function revokeCertificate(token: string, code: string, reason: string) {
  return attempt(() =>
    getClient().mutation(api.admin.revokeCertificate, { token, code, reason }),
  );
}

/** Cheap liveness probe used for the connectivity banner. */
export async function ping(): Promise<boolean> {
  const result = await fetchPublishedModules();
  return result.ok;
}
