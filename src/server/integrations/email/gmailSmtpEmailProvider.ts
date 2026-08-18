import nodemailer, { type Transporter } from "nodemailer";

import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  assertSafeTestEnvelope,
  hasHeaderInjection,
} from "../../../domain/send/testSendPolicy";
import type {
  EmailProvider,
  ProviderConfigStatus,
  ProviderSendResult,
  TestEmailMessage,
} from "./emailProvider";

/**
 * Gmail SMTP adapter — the ONLY code aware of SMTP or Nodemailer (ADR-0014).
 *
 * Authenticates with a Google **App Password** (never an account password) over
 * implicit TLS on port 465. The From mailbox comes from configuration and is asserted
 * against the authorized constant; callers cannot supply it.
 *
 * The app password is never logged, returned, persisted, or included in any error.
 */

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const CONNECTION_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 30_000;

interface SmtpConfig {
  user: string;
  pass: string;
}

/** Google shows app passwords as 4 groups of 4; users often paste them with spaces. */
function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function readConfig(): { config?: SmtpConfig; problems: string[] } {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const user = (process.env.GMAIL_SMTP_USER ?? "").trim();
  const pass = normalizeAppPassword(process.env.GMAIL_APP_PASSWORD ?? "");
  const declaredSender = (process.env.SAFE_TEST_SENDER ?? "").trim();
  const declaredRecipient = (process.env.SAFE_TEST_RECIPIENT ?? "").trim();

  const problems: string[] = [];

  if (provider !== "gmail_smtp") {
    problems.push("EMAIL_PROVIDER must be gmail_smtp.");
  }

  // The SMTP login must BE the authorized sender: Gmail sends as the authenticated
  // account, so a mismatch would silently send from somewhere else.
  if (user === "") {
    problems.push("GMAIL_SMTP_USER is not set.");
  } else if (user.toLowerCase() !== AUTHORIZED_TEST_SENDER) {
    problems.push("GMAIL_SMTP_USER must be " + AUTHORIZED_TEST_SENDER + ".");
  }

  if (pass === "") {
    problems.push("GMAIL_APP_PASSWORD is not set.");
  } else if (pass.length !== 16) {
    // A Google App Password is exactly 16 characters; anything else is an account
    // password or a placeholder and would fail confusingly at send time.
    problems.push("GMAIL_APP_PASSWORD does not look like a 16-character Google App Password.");
  }

  // The declared addresses must agree with the hard-coded constants. They are a
  // cross-check, never the source of truth — an environment variable must not be able
  // to redirect a test email.
  if (declaredSender !== "" && declaredSender.toLowerCase() !== AUTHORIZED_TEST_SENDER) {
    problems.push("SAFE_TEST_SENDER must be " + AUTHORIZED_TEST_SENDER + ".");
  }
  if (declaredRecipient !== "" && declaredRecipient.toLowerCase() !== AUTHORIZED_TEST_RECIPIENT) {
    problems.push("SAFE_TEST_RECIPIENT must be " + AUTHORIZED_TEST_RECIPIENT + ".");
  }

  if (problems.length > 0) return { problems };
  return { config: { user, pass }, problems: [] };
}

interface SmtpErrorShape {
  code?: string;
  responseCode?: number;
}

/** Map an SMTP/Nodemailer failure to a stable, sanitized classification. */
function classify(error: SmtpErrorShape): {
  outcome: "FAILED" | "UNCERTAIN";
  failureCode: string;
  message: string;
} {
  const code = error.code ?? "";
  const status = error.responseCode ?? 0;

  if (code === "EAUTH" || status === 534 || status === 535) {
    return {
      outcome: "FAILED",
      failureCode: "SMTP_AUTH_REJECTED",
      message:
        "Gmail rejected the sign-in. Check that the App Password is current and that 2-Step Verification is on for this account.",
    };
  }
  if (code === "EENVELOPE" || status === 550 || status === 553) {
    return {
      outcome: "FAILED",
      failureCode: "SMTP_ADDRESS_REJECTED",
      message: "Gmail rejected the sender or recipient address.",
    };
  }
  if (status === 421 || status === 450 || status === 451 || status === 452 || status === 454) {
    return {
      outcome: "FAILED",
      failureCode: "SMTP_TEMPORARY",
      message: "Gmail is temporarily unavailable or rate-limiting. Please try again shortly.",
    };
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNRESET") {
    // The message may or may not have been handed over before the connection broke.
    return {
      outcome: "UNCERTAIN",
      failureCode: "SMTP_CONNECTION_LOST",
      message:
        "The connection to Gmail failed before it confirmed the result. The email may or may not have been sent — check the Sent folder before trying again.",
    };
  }
  if (code === "EDNS") {
    return {
      outcome: "FAILED",
      failureCode: "SMTP_DNS",
      message: "Could not reach Gmail (network or DNS problem).",
    };
  }
  if (status >= 500) {
    return {
      outcome: "FAILED",
      failureCode: "SMTP_" + status,
      message: "Gmail refused the message.",
    };
  }
  return {
    outcome: "UNCERTAIN",
    failureCode: "SMTP_UNKNOWN",
    message:
      "Gmail did not return a result we could interpret. Check the Sent folder before trying again.",
  };
}

export class GmailSmtpEmailProvider implements EmailProvider {
  readonly name = "GMAIL_SMTP" as const;

  private transporter: Transporter | undefined;

  checkConfiguration(): ProviderConfigStatus {
    const { config, problems } = readConfig();
    return {
      configured: problems.length === 0,
      problems,
      senderEmail: config ? AUTHORIZED_TEST_SENDER : undefined,
    };
  }

  private getTransporter(config: SmtpConfig): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: true, // implicit TLS
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: CONNECTION_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });
    }
    return this.transporter;
  }

  /**
   * Verify credentials and TLS WITHOUT sending anything — an SMTP handshake plus AUTH
   * only. Called on demand, never on every page load.
   */
  async verifyConnection(): Promise<{ ok: boolean; message: string; failureCode?: string }> {
    const { config, problems } = readConfig();
    if (!config) {
      return {
        ok: false,
        failureCode: "NOT_CONFIGURED",
        message: ("Gmail test email provider is not configured. " + problems.join(" ")).trim(),
      };
    }
    try {
      await this.getTransporter(config).verify();
      return { ok: true, message: "Gmail test email provider ready" };
    } catch (error) {
      const { failureCode, message } = classify((error ?? {}) as SmtpErrorShape);
      return { ok: false, failureCode, message };
    }
  }

  async sendTestEmail(message: TestEmailMessage): Promise<ProviderSendResult> {
    const { config, problems } = readConfig();
    if (!config) {
      return {
        outcome: "FAILED",
        failureCode: "NOT_CONFIGURED",
        message: ("Gmail test email provider is not configured. " + problems.join(" ")).trim(),
      };
    }

    // Defence in depth: the service already validated, but the adapter is the last
    // gate before the network and does not trust its caller.
    const recipient = assertSafeTestEnvelope({ to: message.to });

    // A subject carrying control characters could forge additional SMTP headers.
    if (hasHeaderInjection(message.subject)) {
      return {
        outcome: "FAILED",
        failureCode: "HEADER_INJECTION",
        message: "The subject line contains characters that are not allowed.",
      };
    }

    let info: { accepted?: unknown[]; rejected?: unknown[]; messageId?: string };
    try {
      info = await this.getTransporter(config).sendMail({
        from: AUTHORIZED_TEST_SENDER, // never taken from caller input
        to: recipient,
        subject: message.subject,
        text: message.text,
        html: message.html,
        // No cc, no bcc, no replyTo — the audience cannot widen.
      });
    } catch (error) {
      const { outcome, failureCode, message: friendly } = classify((error ?? {}) as SmtpErrorShape);
      return { outcome, failureCode, message: friendly };
    }

    const accepted = Array.isArray(info.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected : [];

    if (rejected.length > 0 || accepted.length !== 1) {
      return {
        outcome: "FAILED",
        failureCode: "SMTP_NOT_ACCEPTED",
        message: "Gmail did not accept the message for delivery.",
      };
    }

    return {
      outcome: "ACCEPTED",
      statusCode: 250,
      providerMessageId: typeof info.messageId === "string" ? info.messageId : undefined,
      message: "Gmail accepted the test email for delivery.",
    };
  }
}
