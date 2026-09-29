/**
 * Crypto helpers for the Convex runtime.
 *
 * Convex runs a V8 isolate with the Web Crypto API, which is all we need:
 * PBKDF2 for passwords, SHA-256 for opaque tokens, and HMAC for certificate
 * payloads. No third-party crypto dependency, and no secret material in the
 * client bundle.
 */

/** Iterations for PBKDF2-SHA256. ~100k is the OWASP floor for SHA-256. */
const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** JWT segments are base64url: `-`/`_` instead of `+`/`/`, unpadded. */
function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  return fromBase64(padded);
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** URL-safe random string. Used for bearer tokens and certificate codes. */
export function randomToken(bytes = 24): string {
  return toBase64(randomBytes(bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function base64ToBytes(value: string): Uint8Array {
  return fromBase64(value);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export function generateSalt(): string {
  return toHex(randomBytes(16));
}

/** PBKDF2-SHA256, 256-bit output, hex encoded. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/**
 * Constant-time comparison. A plain `===` on a password hash leaks timing
 * information; this does not.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Digests and signatures
// ---------------------------------------------------------------------------

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return toHex(new Uint8Array(digest));
}

/**
 * HMAC-SHA256 over a canonicalised payload.
 *
 * The certificate payload is what a verifier reads. Signing it means a stored
 * certificate that has been edited — an expiry pushed out, a score raised — is
 * detectable on read, not just by convention.
 */
export async function signPayload(
  payload: unknown,
  secret: string,
): Promise<{ signature: string; keyId: string }> {
  const canonical = canonicalJson(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  return { signature: toBase64(sig), keyId: "kavach-hmac-v1" };
}

export async function verifyPayload(
  payload: unknown,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(canonicalJson(payload)));
  return timingSafeEqual(toBase64(expected), signature);
}

// ---------------------------------------------------------------------------
// Google sign-in
// ---------------------------------------------------------------------------

/** Google's rotating signing keys. Public, and safe to fetch on every call. */
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** 60 s of tolerance for clock drift between here and Google. */
const CLOCK_SKEW_SEC = 60;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Verify a Google ID token and return the identity it asserts.
 *
 * The signature check alone is not enough, and neither is decoding the payload
 * and *then* checking the signature. Four things are all required:
 *
 *   - the RSA signature, against Google's published key for the token's `kid`
 *   - `aud` is *our* client id, so a token minted for some other application
 *     cannot be replayed at this deployment
 *   - `iss` is Google and `exp` is in the future
 *   - `email_verified` is true, because an unverified Google address can be
 *     made to look like someone else's
 *
 * `email_verified` is the one that is easy to forget and expensive to skip: it
 * is what makes it safe to let a Google sign-in reach an account that already
 * exists under that address.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  nowMs = Date.now(),
): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  const headerSeg = parts[0];
  const payloadSeg = parts[1];
  const signatureSeg = parts[2];
  if (!headerSeg || !payloadSeg || !signatureSeg || parts.length !== 3) {
    throw new Error("Malformed Google token.");
  }

  const header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerSeg))) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") {
    // Pins the algorithm. Without this an attacker could present an HMAC key
    // they chose and sign their own token with it.
    throw new Error("Unexpected Google token algorithm.");
  }
  if (!header.kid) throw new Error("Google token is missing a key id.");

  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) throw new Error("Could not reach Google's signing keys.");
  const jwks = (await response.json()) as { keys?: JsonWebKey[] };
  const jwk = jwks.keys?.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("Google's signing key for this token is not published.");

  const key = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: ["verify"], ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    fromBase64Url(signatureSeg) as unknown as ArrayBuffer,
    enc.encode(`${headerSeg}.${payloadSeg}`),
  );
  if (!valid) throw new Error("Google token signature is invalid.");

  // Only now is it safe to read the payload.
  const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadSeg))) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!claims.aud || claims.aud !== clientId) {
    throw new Error("Google token was issued for a different application.");
  }
  if (!claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) {
    throw new Error("Google token issuer is not Google.");
  }
  const nowSec = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SEC < nowSec) {
    throw new Error("Google token has expired.");
  }
  if (claims.email_verified !== true) {
    throw new Error("Google has not verified this email address.");
  }
  if (!claims.email || !claims.sub) {
    throw new Error("Google token is missing an identity.");
  }

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

/**
 * Deterministic JSON: keys sorted at every level so the same payload always
 * produces the same bytes, on any runtime, in any key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
