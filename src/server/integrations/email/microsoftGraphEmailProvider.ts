import { ConfidentialClientApplication } from "@azure/msal-node";

import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  assertSafeTestEnvelope,
} from "../../../domain/send/testSendPolicy";
import type {
  EmailProvider,
  ProviderConfigStatus,
  ProviderSendResult,
  TestEmailMessage,
} from "./emailProvider";

/**
 * Microsoft Graph adapter — the ONLY code aware of Graph or MSAL (ADR-0004 / ADR-0013).
 *
 * App-only (client credentials) authentication, so `/me/sendMail` is meaningless; the
 * sender mailbox is addressed explicitly via `/users/{sender}/sendMail`.
 *
 * The sender comes from configuration and is asserted against the authorized constant.
 * Callers cannot supply it. No token, secret, or Authorization header is ever logged,
 * returned, or persisted.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const REQUEST_TIMEOUT_MS = 30_000;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A tenant may be a GUID or a verified domain such as `axis-gps.onmicrosoft.com`. */
const TENANT_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
}

function readConfig(): { config?: GraphConfig; problems: string[] } {
  const tenantId = (process.env.MICROSOFT_TENANT_ID ?? "").trim();
  const clientId = (process.env.MICROSOFT_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET ?? "").trim();
  const senderEmail = (process.env.MICROSOFT_SENDER_EMAIL ?? AUTHORIZED_TEST_SENDER).trim();

  const problems: string[] = [];

  // Presence AND shape are checked: a placeholder such as "xxx" is "set" but unusable,
  // and reporting it as configured would produce a confusing failure at send time.
  if (tenantId === "") problems.push("MICROSOFT_TENANT_ID is not set.");
  else if (!GUID.test(tenantId) && !TENANT_DOMAIN.test(tenantId)) {
    problems.push("MICROSOFT_TENANT_ID does not look like a directory (tenant) ID or domain.");
  }

  if (clientId === "") problems.push("MICROSOFT_CLIENT_ID is not set.");
  else if (!GUID.test(clientId)) {
    problems.push("MICROSOFT_CLIENT_ID does not look like an application (client) ID.");
  }

  if (clientSecret === "") problems.push("MICROSOFT_CLIENT_SECRET is not set.");
  else if (clientSecret.length < 20) {
    problems.push("MICROSOFT_CLIENT_SECRET looks like a placeholder rather than a real secret.");
  }

  if (senderEmail.toLowerCase() !== AUTHORIZED_TEST_SENDER) {
    problems.push(`MICROSOFT_SENDER_EMAIL must be ${AUTHORIZED_TEST_SENDER}.`);
  }

  if (problems.length > 0) return { problems };
  return { config: { tenantId, clientId, clientSecret, senderEmail }, problems: [] };
}

/** Map a Graph HTTP status to a stable, sanitized classification. */
function classify(status: number): { failureCode: string; message: string } {
  if (status === 401) {
    return {
      failureCode: "GRAPH_UNAUTHORIZED",
      message: "Microsoft rejected the application's credentials. Check the client secret and tenant.",
    };
  }
  if (status === 403) {
    return {
      failureCode: "GRAPH_FORBIDDEN",
      message:
        "Microsoft refused the send. The application is not permitted to send as this mailbox.",
    };
  }
  if (status === 404) {
    return {
      failureCode: "GRAPH_SENDER_NOT_FOUND",
      message: "Microsoft could not find the sender mailbox.",
    };
  }
  if (status === 429) {
    return {
      failureCode: "GRAPH_THROTTLED",
      message: "Microsoft is throttling requests. Please wait a moment and try again.",
    };
  }
  if (status >= 500) {
    return {
      failureCode: "GRAPH_SERVER_ERROR",
      message: "Microsoft had a temporary problem. Please try again shortly.",
    };
  }
  return {
    failureCode: `GRAPH_HTTP_${status}`,
    message: "Microsoft could not accept the email.",
  };
}

export class MicrosoftGraphEmailProvider implements EmailProvider {
  readonly name = "MICROSOFT_GRAPH" as const;

  private client: ConfidentialClientApplication | undefined;

  checkConfiguration(): ProviderConfigStatus {
    const { config, problems } = readConfig();
    return {
      configured: problems.length === 0,
      problems,
      senderEmail: config?.senderEmail,
    };
  }

  private getClient(config: GraphConfig): ConfidentialClientApplication {
    if (!this.client) {
      this.client = new ConfidentialClientApplication({
        auth: {
          clientId: config.clientId,
          authority: `https://login.microsoftonline.com/${config.tenantId}`,
          clientSecret: config.clientSecret,
        },
      });
    }
    return this.client;
  }

  async sendTestEmail(message: TestEmailMessage): Promise<ProviderSendResult> {
    const { config, problems } = readConfig();
    if (!config) {
      return {
        outcome: "FAILED",
        failureCode: "NOT_CONFIGURED",
        message: `Microsoft email provider is not configured. ${problems.join(" ")}`.trim(),
      };
    }

    // Defence in depth: the service already validated, but the adapter is the last
    // gate before the network and does not trust its caller.
    const recipient = assertSafeTestEnvelope({ to: message.to });
    const sender = config.senderEmail.toLowerCase();
    if (sender !== AUTHORIZED_TEST_SENDER || recipient !== AUTHORIZED_TEST_RECIPIENT) {
      return {
        outcome: "FAILED",
        failureCode: "UNAUTHORIZED_ADDRESS",
        message: "Refused: the sender or recipient is not the authorised test address.",
      };
    }

    // ---- token ----
    let accessToken: string;
    try {
      const result = await this.getClient(config).acquireTokenByClientCredential({
        scopes: [GRAPH_SCOPE],
      });
      if (!result?.accessToken) {
        return {
          outcome: "FAILED",
          failureCode: "TOKEN_EMPTY",
          message: "Microsoft did not return an access token. Check the application credentials.",
        };
      }
      accessToken = result.accessToken;
    } catch {
      // The MSAL error may embed request details; deliberately not surfaced or logged.
      return {
        outcome: "FAILED",
        failureCode: "TOKEN_ACQUISITION_FAILED",
        message:
          "Could not sign in to Microsoft with the application credentials. Check the tenant ID, client ID and secret.",
      };
    }

    // ---- send ----
    const body = {
      message: {
        subject: message.subject,
        body: { contentType: "HTML", content: message.html },
        toRecipients: [{ emailAddress: { address: recipient } }],
        // No ccRecipients / bccRecipients / replyTo — the audience cannot widen.
      },
      // Keep a copy in the sender's Sent Items so the first test can be verified by hand.
      saveToSentItems: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "client-request-id": message.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Network error or timeout: Microsoft may or may not have accepted the message.
      // Reported as UNCERTAIN and NEVER auto-retried — a retry could duplicate real mail.
      return {
        outcome: "UNCERTAIN",
        failureCode: "NETWORK_OR_TIMEOUT",
        message:
          "The connection to Microsoft failed before a reply arrived. The email may or may not have been sent — check the sender's Sent Items before trying again.",
      };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 202) {
      return {
        outcome: "ACCEPTED",
        statusCode: 202,
        // Graph returns no message id for sendMail; the correlation id aids support.
        providerMessageId: response.headers.get("request-id") ?? undefined,
        message: "Microsoft 365 accepted the test email for delivery.",
      };
    }

    const { failureCode, message: friendly } = classify(response.status);
    return { outcome: "FAILED", statusCode: response.status, failureCode, message: friendly };
  }
}
