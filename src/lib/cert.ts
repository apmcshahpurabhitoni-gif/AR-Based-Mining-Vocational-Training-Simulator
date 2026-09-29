/**
 * Certificate URL helpers.
 *
 * Kept in one place because the QR payload, the share link, and the verification
 * route all have to agree. A mismatch here means a certificate that scans to a
 * 404, which is the single most embarrassing failure this product can have.
 */

const DEFAULT_BASE =
  typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";

export const CERT_URL_BASE = DEFAULT_BASE;

/** Normalise whatever was typed or scanned into a canonical code. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function verifyUrl(code: string): string {
  return `${CERT_URL_BASE}/verify/${normaliseCode(code)}`;
}
