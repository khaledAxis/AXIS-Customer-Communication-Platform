import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The capability a recipient holds to unsubscribe themselves (ADR-0024).
 *
 * DESIGN: the token is a 32-byte random secret and carries NO DATA. Everything the
 * endpoint needs — which address, which campaign — lives on the database row it
 * matches. That single choice answers most of the requirements at once:
 *
 *   - **Unguessable.** 256 bits of CSPRNG output.
 *   - **Tamper-proof without a signature.** There is no payload to alter; changing any
 *     character produces a value that matches no row, so a modified token cannot
 *     resolve to a different address. It cannot resolve to *any* address.
 *   - **No internal identifiers exposed.** No `CommunicationAddress` id, contact id,
 *     company id, Monday id or email appears in the URL.
 *   - **Contains no secret of ours.** It is not signed with a server key, so a leaked
 *     token compromises exactly one address's unsubscribe and nothing else.
 *   - **Storable like a password.** Only the SHA-256 is persisted, so a database leak
 *     yields no working links.
 *
 * A signed/encrypted payload (JWT-style) was the alternative and is weaker here: it
 * embeds identifiers, is only as strong as one signing key, cannot be revoked, and
 * grows the URL. Nothing in this flow needs statelessness — the endpoint has a
 * database.
 *
 * SHA-256 rather than a slow KDF is correct for this one case: the input is 256 bits
 * of uniform randomness, so there is no dictionary to attack and no work factor to
 * buy. That reasoning does NOT transfer to passwords, which use Argon2id.
 *
 * `node:crypto` is stdlib and every function here is deterministic given its input,
 * so `domain/` stays free of I/O and framework imports.
 */

/** Bytes of entropy in a token. 32 bytes → 43 base64url characters. */
export const TOKEN_BYTES = 32;

/**
 * The exact length a real token has once encoded. Used to reject obviously-malformed
 * input before it reaches the database.
 */
export const TOKEN_LENGTH = 43;

/**
 * The constant, inert token used in SAFE TEST and preview messages.
 *
 * It is a fixed string on purpose: the SAFE TEST approval hash covers the rendered
 * HTML (ADR-0013), so a freshly-minted token per render would change the HTML every
 * time and no approval could ever match. This value resolves to nothing, unsubscribes
 * nobody, and the endpoint says so plainly.
 */
export const TEST_UNSUBSCRIBE_TOKEN = "safe-test-preview-link" as const;

export function isTestUnsubscribeToken(token: string): boolean {
  return token === TEST_UNSUBSCRIBE_TOKEN;
}

/** Base64url, no padding — safe in a URL path segment without escaping. */
function encode(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface MintedToken {
  /** The secret that goes in the URL. Shown once, never stored. */
  token: string;
  /** What the database keeps. */
  tokenHash: string;
}

export function mintUnsubscribeToken(): MintedToken {
  const token = encode(randomBytes(TOKEN_BYTES));
  return { token, tokenHash: hashUnsubscribeToken(token) };
}

export function hashUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Shape check before any lookup.
 *
 * Cheap, and it keeps obviously-junk input (path traversal attempts, SQL fragments,
 * enormous strings) away from the database entirely.
 */
export function looksLikeUnsubscribeToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

/**
 * Constant-time comparison of two hashes.
 *
 * The lookup is by unique index, so timing is not really the exposure here — but a
 * comparison that short-circuits on the first differing character is a habit worth
 * not forming.
 */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// ---------------------------------------------------------------------------
// What the endpoint may say
// ---------------------------------------------------------------------------

/**
 * Every failure looks the same to the browser.
 *
 * A distinguishable "no such token" versus "this address does not exist" would turn
 * the endpoint into an oracle for guessing which addresses AXIS holds. The reason is
 * available server-side for the audit trail; the page is not.
 */
export const UNSUBSCRIBE_INVALID_MESSAGE =
  "This unsubscribe link is not valid. It may have been mistyped, or it may belong to a different message." as const;

export const UNSUBSCRIBE_TEST_LINK_MESSAGE =
  "This is a preview link from an internal AXIS test message. It is not connected to any customer address, and nothing has been changed." as const;

export type TokenRejection =
  | "MALFORMED"
  | "UNKNOWN"
  | "REVOKED"
  | "TEST_TOKEN"
  | "RATE_LIMITED";
