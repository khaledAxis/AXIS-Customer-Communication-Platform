import {
  DEFAULT_NEWSLETTER_REPLY_TO,
  NEWSLETTER_SENDER_NAME,
  validateReplyTo,
} from "../../../domain/send/replyTo";
import { AUTHORIZED_TEST_SENDER } from "../../../domain/send/testSendPolicy";

/**
 * The one place the newsletter sender identity is resolved (ADR-0019).
 *
 * Both the service (which hashes the approved message and renders the preview) and
 * the SMTP adapter (which submits it) call this, so what is approved and what is sent
 * cannot diverge. If the configured value ever changed between the two, the re-hash
 * at send time would refuse the stale approval rather than send something unapproved.
 */

export interface SenderIdentity {
  /** The authenticated Gmail mailbox. Never configurable by a caller. */
  fromEmail: string;
  /** Friendly name shown in the inbox. */
  senderName: string;
  /** The single address replies are directed to. */
  replyToEmail: string;
  /** Sanitized reasons the configured value was rejected (never contains a secret). */
  problems: string[];
}

/**
 * Resolves the sender identity from configuration.
 *
 * An unset `NEWSLETTER_REPLY_TO` falls back to the documented no-reply address; a set
 * but malformed one is REFUSED (reported in `problems`) rather than quietly ignored,
 * because silently falling back would hide a misconfiguration that redirects replies.
 */
export function getSenderIdentity(): SenderIdentity {
  const raw = process.env.NEWSLETTER_REPLY_TO;
  const configured = typeof raw === "string" ? raw : "";

  if (configured.trim() === "") {
    return {
      fromEmail: AUTHORIZED_TEST_SENDER,
      senderName: NEWSLETTER_SENDER_NAME,
      replyToEmail: DEFAULT_NEWSLETTER_REPLY_TO,
      problems: [],
    };
  }

  const result = validateReplyTo(configured);
  if (!result.ok) {
    return {
      fromEmail: AUTHORIZED_TEST_SENDER,
      senderName: NEWSLETTER_SENDER_NAME,
      // Fall back to the safe constant for display, but report the problem so the UI
      // blocks sending instead of pretending the configuration is fine.
      replyToEmail: DEFAULT_NEWSLETTER_REPLY_TO,
      problems: [result.message],
    };
  }

  return {
    fromEmail: AUTHORIZED_TEST_SENDER,
    senderName: NEWSLETTER_SENDER_NAME,
    replyToEmail: result.address,
    problems: [],
  };
}
