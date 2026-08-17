/**
 * Conservative email normalization for recipient deduplication (ADR-0009 §6).
 *
 * Rules (deliberately conservative — safe against over-collapsing distinct people):
 *   - trim surrounding whitespace
 *   - lowercase
 *   - validate syntax with a conservative single-@ pattern
 *   - DO NOT strip Gmail dots
 *   - DO NOT remove `+tag` suffixes
 *   - DO NOT perform any provider-specific canonicalization
 *
 * The `normalized` value is what participates in uniqueness
 * (`CommunicationAddress.normalizedEmail`, `CampaignRecipient(campaignId, normalizedEmail)`).
 * The original/source email is preserved separately by callers.
 */

export type NormalizedEmail =
  | { kind: "none" }
  | { kind: "invalid"; raw: string }
  | { kind: "valid"; raw: string; normalized: string };

// Conservative: exactly one "@", non-empty local part, a dotted domain, no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): NormalizedEmail {
  if (raw == null) return { kind: "none" };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "none" };

  // Lowercase the whole address (local + domain). `+tags` and `.` are preserved.
  const normalized = trimmed.toLowerCase();

  if (!EMAIL_RE.test(normalized)) return { kind: "invalid", raw: trimmed };
  return { kind: "valid", raw: trimmed, normalized };
}
