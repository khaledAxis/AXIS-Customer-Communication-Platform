import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import {
  assertSafeQaEnvelope,
  type QaRecipient,
} from "../../../domain/send/qaPolicy";
import { assertValidReplyTo } from "../../../domain/send/replyTo";
import { hasHeaderInjection } from "../../../domain/send/testSendPolicy";
import type { ProviderSendResult } from "./emailProvider";
import { getSenderIdentity } from "./senderIdentity";

/**
 * The QA email transport (ADR-0027).
 *
 * A THIRD port, deliberately separate from both `EmailProvider` (SAFE TEST, one
 * address) and `ProductionEmailProvider` (customers, disabled). Three distinct TYPES
 * mean a mis-wired registry is a compile error rather than an incident, and it means
 * this adapter cannot be handed to the SAFE TEST path — which is how the existing
 * hard-lock stays exactly as strong as it was.
 *
 * It shares the Gmail SMTP *credentials* because that is the only transport AXIS has
 * configured, but it shares no POLICY: SAFE TEST's `assertSafeTestEnvelope` is never
 * called here, and `assertSafeQaEnvelope` is never called there.
 *
 * The audience is unrepresentable: `QaEmailMessage` has no `from`, `cc`, `bcc` or
 * `replyTo`, and `to` is typed as the four-member union. A fifth address cannot be
 * expressed, and is refused again at runtime immediately before the network call.
 */

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // implicit TLS
const CONNECTION_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 20_000;

/** The Gmail mailbox QA mail is sent from. Gmail sends as the authenticated account. */
export const QA_SENDER_EMAIL = "axisgpscana@gmail.com" as const;
export const QA_SENDER_NAME = "AXIS Advanced Mapping Solutions" as const;

export interface QaEmailMessage {
  /** One of the four approved addresses. Re-validated inside the adapter. */
  to: QaRecipient;
  /** Must already carry the QA prefix; the adapter refuses it otherwise. */
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface QaProviderStatus {
  configured: boolean;
  problems: string[];
  senderEmail: string | null;
  replyToEmail: string | null;
}

export interface QaEmailProvider {
  readonly name: "GMAIL_QA" | "FAKE_QA";
  /** Cheap and local. Never opens a connection. */
  checkConfiguration(): QaProviderStatus;
  send(message: QaEmailMessage): Promise<ProviderSendResult>;
}

interface QaSmtpConfig {
  user: string;
  pass: string;
  replyTo: string;
  senderName: string;
}

/** A Google App Password is 16 letters, conventionally shown in groups of four. */
function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function readConfig(): { config: QaSmtpConfig | null; problems: string[] } {
  const problems: string[] = [];

  const user = (process.env.GMAIL_SMTP_USER ?? "").trim().toLowerCase();
  const pass = normalizeAppPassword(process.env.GMAIL_APP_PASSWORD ?? "");

  if (user === "") problems.push("GMAIL_SMTP_USER is not set.");
  else if (user !== QA_SENDER_EMAIL) {
    // Gmail sends as the authenticated account, so a mismatch would silently send
    // from an address nobody authorised.
    problems.push(`GMAIL_SMTP_USER must be ${QA_SENDER_EMAIL}.`);
  }

  if (pass === "") problems.push("GMAIL_APP_PASSWORD is not set.");
  else if (!/^[a-z]{16}$/i.test(pass)) {
    problems.push(
      "GMAIL_APP_PASSWORD does not look like a 16-character Google App Password.",
    );
  }

  let replyTo = "";
  try {
    replyTo = assertValidReplyTo(process.env.NEWSLETTER_REPLY_TO);
  } catch {
    problems.push("NEWSLETTER_REPLY_TO is not a single valid email address.");
  }

  if (problems.length > 0) return { config: null, problems };

  const identity = getSenderIdentity();
  return {
    config: { user, pass, replyTo, senderName: identity.senderName },
    problems: [],
  };
}

/** Whether QA email is switched on. Environment only — no UI writes it. */
export function qaEmailEnabled(): boolean {
  return (process.env.QA_EMAIL_ENABLED ?? "").trim() === "true";
}

export class GmailQaEmailProvider implements QaEmailProvider {
  readonly name = "GMAIL_QA" as const;

  private transporter: Transporter | undefined;

  checkConfiguration(): QaProviderStatus {
    const { config, problems } = readConfig();
    return {
      configured: problems.length === 0,
      problems,
      senderEmail: config ? QA_SENDER_EMAIL : null,
      replyToEmail: config?.replyTo ?? null,
    };
  }

  private getTransporter(config: QaSmtpConfig): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: true,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: CONNECTION_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });
    }
    return this.transporter;
  }

  async send(message: QaEmailMessage): Promise<ProviderSendResult> {
    const { config, problems } = readConfig();
    if (!config) {
      return {
        outcome: "FAILED",
        failureCode: "NOT_CONFIGURED",
        message: ("QA email transport is not configured. " + problems.join(" ")).trim(),
      };
    }

    // THE LAST GATE. The service already checked; this checks again, here, because
    // the next line opens a socket and a mistake past this point is a real email in
    // somebody's inbox. Throws rather than returning a result — a widened audience is
    // not a "failed send", it is a bug that must not be swallowed.
    const recipient = assertSafeQaEnvelope({ to: message.to, subject: message.subject });

    if (hasHeaderInjection(message.subject)) {
      return {
        outcome: "FAILED",
        failureCode: "HEADER_INJECTION",
        message: "The subject line contains characters that are not allowed.",
      };
    }

    let replyTo: string;
    try {
      replyTo = assertValidReplyTo(config.replyTo);
    } catch {
      return {
        outcome: "FAILED",
        failureCode: "INVALID_REPLY_TO",
        message: "The configured reply address is not a single valid email address.",
      };
    }

    let info: { accepted?: unknown[]; rejected?: unknown[]; messageId?: string };
    try {
      info = await this.getTransporter(config).sendMail({
        // Sender is configuration, never caller input.
        from: { name: config.senderName ?? QA_SENDER_NAME, address: QA_SENDER_EMAIL },
        // The CONSTANT returned by the gate, not `message.to`.
        to: recipient,
        replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        // No cc, no bcc, no headers object — there is nothing here to widen.
      });
    } catch (error) {
      const shape = (error ?? {}) as { code?: string; responseCode?: number };
      const code = shape.code ?? "";
      if (
        code === "ETIMEDOUT" ||
        code === "ESOCKET" ||
        code === "ECONNECTION" ||
        code === "ECONNRESET"
      ) {
        // May or may not have been handed over. Never auto-retried.
        return {
          outcome: "UNCERTAIN",
          failureCode: "SMTP_CONNECTION_LOST",
          message:
            "The connection to Gmail failed before it confirmed the result. Check the Sent folder before trying again.",
        };
      }
      if (code === "EAUTH" || shape.responseCode === 535) {
        return {
          outcome: "FAILED",
          failureCode: "SMTP_AUTH_REJECTED",
          message: "Gmail rejected the sign-in. Check the App Password.",
        };
      }
      return {
        outcome: "FAILED",
        failureCode: "SMTP_ERROR",
        message: "Gmail refused the message.",
      };
    }

    const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
    const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;

    if (accepted === 1 && rejected === 0) {
      return {
        outcome: "ACCEPTED",
        statusCode: 250,
        providerMessageId: info.messageId,
        // Accepted, not delivered. SMTP 250 means Gmail took responsibility.
        message: "Gmail accepted the QA email for delivery.",
      };
    }

    if (rejected > 0) {
      return {
        outcome: "FAILED",
        failureCode: "SMTP_ADDRESS_REJECTED",
        message: "Gmail rejected the recipient address.",
      };
    }

    return {
      outcome: "UNCERTAIN",
      failureCode: "SMTP_UNREADABLE",
      message:
        "Gmail did not return a result we could interpret. Check the Sent folder before trying again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let override: QaEmailProvider | undefined;
let singleton: QaEmailProvider | undefined;
let refusing: QaEmailProvider | undefined;

function inTestRunner(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

/**
 * Under the test runner nothing network-capable is handed out, exactly as for the
 * other two ports: this machine holds a real App Password and the suite reads the
 * same environment.
 */
class RefusingQaProvider implements QaEmailProvider {
  readonly name = "FAKE_QA" as const;

  checkConfiguration(): QaProviderStatus {
    return {
      configured: false,
      problems: ["No QA provider was injected for this test, so nothing can be sent."],
      senderEmail: null,
      replyToEmail: null,
    };
  }

  async send(): Promise<never> {
    throw new Error(
      "A test attempted to send a real QA email. Inject a fake with " +
        "setQaEmailProviderForTesting instead.",
    );
  }
}

export function getQaEmailProvider(): QaEmailProvider {
  if (override) return override;
  if (inTestRunner()) {
    refusing ??= new RefusingQaProvider();
    return refusing;
  }
  singleton ??= new GmailQaEmailProvider();
  return singleton;
}

export function setQaEmailProviderForTesting(provider: QaEmailProvider | undefined): void {
  override = provider;
}
