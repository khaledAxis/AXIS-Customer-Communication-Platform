import { normalizeEmail } from "../email/normalizeEmail";
import { hasHeaderInjection } from "./testSendPolicy";

/**
 * Newsletter sender identity: the display name shown in the inbox, and the single
 * no-reply address replies are directed to (ADR-0019).
 *
 * Replies must not land in the authenticated Gmail mailbox, so every newsletter
 * carries `Reply-To: noreply@axis-gps.com`. The authenticated sender is unchanged —
 * Gmail sends as the account that signed in, and only the reply destination moves.
 *
 * This is CENTRAL configuration, not a per-newsletter field: there is no UI input, no
 * form value, and no service parameter that can set it. A caller-supplied reply-to is
 * still refused outright by `assertSafeTestEnvelope`.
 *
 * Pure: no I/O, no framework imports. The environment is read in `server/`.
 */

/** Shown as the friendly From name. Never another company's brand. */
export const NEWSLETTER_SENDER_NAME = "AXIS Advanced Mapping Solutions" as const;

/** Used when `NEWSLETTER_REPLY_TO` is not configured. */
export const DEFAULT_NEWSLETTER_REPLY_TO = "noreply@axis-gps.com" as const;

/**
 * Shown in the send panel. The email client's own Reply button cannot be removed —
 * it belongs to Gmail/Outlook — so the honest statement is that replies are not read.
 */
export const REPLY_NOT_MONITORED_NOTICE =
  "Replies to this newsletter are not monitored." as const;

export type ReplyToRejection =
  | "EMPTY"
  | "NOT_A_SINGLE_ADDRESS"
  | "HEADER_INJECTION"
  | "INVALID_ADDRESS";

export class InvalidReplyToError extends Error {
  readonly reason: ReplyToRejection;

  constructor(reason: ReplyToRejection) {
    super(`Rejected Reply-To address: ${reason}`);
    this.name = "InvalidReplyToError";
    this.reason = reason;
  }
}

export const REPLY_TO_REJECTION_MESSAGE: Record<ReplyToRejection, string> = {
  EMPTY: "NEWSLETTER_REPLY_TO is empty.",
  NOT_A_SINGLE_ADDRESS:
    "NEWSLETTER_REPLY_TO must be exactly one plain address — no lists, and no display name.",
  HEADER_INJECTION: "NEWSLETTER_REPLY_TO contains characters that are not allowed.",
  INVALID_ADDRESS: "NEWSLETTER_REPLY_TO is not a valid email address.",
};

/**
 * Characters that would make the value more than one bare address: a list separator,
 * a display-name wrapper, or an SMTP group syntax marker. Any of them is a refusal,
 * never a value we trim down to something "safe".
 */
function looksLikeMoreThanOneAddress(value: string): boolean {
  return (
    value.includes(",") ||
    value.includes(";") ||
    value.includes("<") ||
    value.includes(">") ||
    value.includes(":") ||
    /\s/.test(value)
  );
}

export type ReplyToResult =
  | { ok: true; address: string }
  | { ok: false; reason: ReplyToRejection; message: string };

/**
 * Validate a configured reply-to value.
 *
 * Accepts exactly one bare address. An array, a comma-separated list, a
 * `Name <addr>` form, or anything containing a control character is refused —
 * refusing is the only safe response, because a smuggled CR/LF can forge a `Bcc:`
 * header and silently widen the audience.
 */
export function validateReplyTo(raw: unknown): ReplyToResult {
  const fail = (reason: ReplyToRejection): ReplyToResult => ({
    ok: false,
    reason,
    message: REPLY_TO_REJECTION_MESSAGE[reason],
  });

  // An array is a list of addresses by definition — never acceptable.
  if (Array.isArray(raw)) return fail("NOT_A_SINGLE_ADDRESS");
  if (typeof raw !== "string") return fail("EMPTY");

  // Injection is checked on the RAW value, before trimming: trimming a trailing
  // newline first would hide exactly the attack this refuses.
  if (hasHeaderInjection(raw)) return fail("HEADER_INJECTION");

  const value = raw.trim();
  if (value === "") return fail("EMPTY");
  if (looksLikeMoreThanOneAddress(value)) return fail("NOT_A_SINGLE_ADDRESS");

  const parsed = normalizeEmail(value);
  if (parsed.kind !== "valid") return fail("INVALID_ADDRESS");

  return { ok: true, address: parsed.normalized };
}

/** Throwing form, for the last gate before the network. */
export function assertValidReplyTo(raw: unknown): string {
  const result = validateReplyTo(raw);
  if (!result.ok) throw new InvalidReplyToError(result.reason);
  return result.address;
}

/**
 * The From header value: a display name plus the authenticated address.
 * The name is guarded too — a control character in it would forge a header just as
 * effectively as one in an address.
 */
export function formatSender(address: string, name: string = NEWSLETTER_SENDER_NAME): string {
  if (hasHeaderInjection(name) || name.includes("\"")) {
    throw new InvalidReplyToError("HEADER_INJECTION");
  }
  return `"${name}" <${address}>`;
}
