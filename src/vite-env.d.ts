/// <reference types="vite/client" />

/**
 * KAVACH reads one build-time variable: the Convex deployment URL. It defaults
 * to the local deployment, because that is what the pilot and the demo both
 * run against — there is no cloud project to point at.
 *
 * `import.meta.env` is typed here rather than left implicit so a typo in an
 * env var name is a compile error rather than a silent `undefined` at runtime.
 */
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;

  /**
   * Google OAuth client id. Public by design — it is shipped to every browser
   * and the real secret never leaves the server. When this is absent the sign-in
   * button is not rendered at all, which is the correct state for a no-egress
   * plant LAN deployment.
   *
   * Must match the `GOOGLE_CLIENT_ID` set on the Convex deployment: the server
   * checks the token's `aud` against it.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
