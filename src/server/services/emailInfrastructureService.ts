import "server-only";

import {
  planSpfMerge,
  recommendDmarc,
  unknownDomainAuth,
  type DmarcRecommendation,
  type DomainAuthStatus,
  type RequiredDnsRecord,
  type SpfGuidance,
} from "../../domain/delivery/domainAuth";
import {
  PRODUCTION_SENDER_EMAIL,
  PRODUCTION_SENDER_NAME,
} from "../../domain/delivery/pilotPolicy";
import { getPrisma } from "../db/prisma";
import {
  RESEND_SPF_INCLUDE,
  getProductionEmailProvider,
  productionDeliveryEnabled,
  productionSendingDomain,
  providerPilotEnabled,
} from "../integrations/email";
import { validatePublicAppUrl } from "../../domain/unsubscribe/publicUrl";
import { requireCapability } from "../auth/session";

/**
 * The email-infrastructure read model (ADR-0025).
 *
 * One screen that answers "what would actually happen if AXIS sent a newsletter?" —
 * provider, sender, domain authentication, webhook, public unsubscribe, and the
 * production lock. Deliberately reported as SEPARATE facts: there is no single green
 * badge, because "ready" is a claim this platform must never make on the strength of
 * local configuration alone.
 *
 * Nothing here sends anything. The only network call is `refreshDomainStatus`, which
 * READS the domain's state from the provider.
 */

export type FactState = "OK" | "ACTION_REQUIRED" | "UNKNOWN" | "LOCKED";

export interface InfrastructureFact {
  label: string;
  state: FactState;
  /** What is true right now, in plain words. */
  detail: string;
  /** What a human must do next, when anything is required of them. */
  remedy: string | null;
}

export interface EmailInfrastructureView {
  provider: {
    name: string;
    configured: boolean;
    /** Where the key must live. NEVER the key itself, or any part of it. */
    keyLocation: string;
    facts: InfrastructureFact[];
  };
  sender: {
    productionFrom: string;
    productionReplyTo: string | null;
    safeTestFrom: string;
    safeTestTo: string;
  };
  domain: DomainAuthStatus & {
    lastCheckedAt: Date | null;
    facts: InfrastructureFact[];
    records: RequiredDnsRecord[];
  };
  dmarc: DmarcRecommendation;
  spf: SpfGuidance;
  webhook: {
    /** The path Resend must be pointed at. */
    path: string;
    /** The full URL, once a public origin exists. */
    url: string | null;
    secretConfigured: boolean;
    facts: InfrastructureFact[];
  };
  publicUnsubscribe: {
    origin: string | null;
    reachable: boolean;
    facts: InfrastructureFact[];
  };
  productionSending: {
    enabled: boolean;
    pilotEnabled: boolean;
    facts: InfrastructureFact[];
  };
}

export const RESEND_WEBHOOK_PATH = "/api/webhooks/resend" as const;

/**
 * The configured public origin, or null when it is unusable.
 *
 * Development origins are accepted here only so the screen can SAY what is configured;
 * every fact that depends on public reachability checks the value separately.
 */
function publicAppOrigin(): string | null {
  const result = validatePublicAppUrl(process.env.PUBLIC_APP_URL, {
    allowDevelopmentOrigins: true,
  });
  return result.ok ? result.origin : null;
}

function replyToOrNull(): string | null {
  const value = (process.env.NEWSLETTER_REPLY_TO ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Reads the last stored domain report. A snapshot, not a live answer — the screen
 * shows when it was taken so nobody mistakes a week-old "verified" for a fact.
 */
export async function readStoredDomainStatus(
  domain: string,
): Promise<{ status: DomainAuthStatus; checkedAt: Date | null }> {
  const prisma = getPrisma();
  const row = await prisma.providerDomainSnapshot.findUnique({
    where: { provider_domain: { provider: "RESEND", domain } },
  });
  if (!row) return { status: unknownDomainAuth(domain), checkedAt: null };

  return {
    status: {
      domain: row.domain,
      providerStatus: row.status,
      spf: row.spf as DomainAuthStatus["spf"],
      dkim: row.dkim as DomainAuthStatus["dkim"],
      // Never stored as verified: AXIS publishes DMARC, and no provider report proves it.
      dmarc: "UNKNOWN",
      verified: row.status.toLowerCase() === "verified",
      records: (row.records as unknown as RequiredDnsRecord[]) ?? [],
    },
    checkedAt: row.checkedAt,
  };
}

/**
 * Asks the provider for the current domain state and stores the answer.
 *
 * READ ONLY at the provider: it lists and reads a domain. It creates nothing, edits no
 * DNS, and sends no email. ADMIN only, and audited — a domain check is a deliberate
 * act, not a page render.
 */
export async function refreshDomainStatus(): Promise<
  | { ok: true; status: DomainAuthStatus }
  | { ok: false; message: string }
> {
  const actor = await requireCapability("MANAGE_USERS");
  const domain = productionSendingDomain();
  const provider = getProductionEmailProvider();

  if (!provider.fetchDomainStatus) {
    return {
      ok: false,
      message:
        "Resend is not configured, so the sending domain cannot be checked. Add RESEND_API_KEY to .env.local and restart the server.",
    };
  }

  let status: DomainAuthStatus | null;
  try {
    status = await provider.fetchDomainStatus(domain);
  } catch {
    // Never surface the provider's raw error: it can echo request details, and an
    // API-key problem must not become a log line containing the key.
    return {
      ok: false,
      message:
        "Resend could not be reached, or it refused the request. Check the API key in .env.local and try again.",
    };
  }

  if (!status) {
    return {
      ok: false,
      message: `Resend does not know the domain ${domain}. Add it in the Resend dashboard, publish the DNS records it gives you, then check again.`,
    };
  }

  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.providerDomainSnapshot.upsert({
      where: { provider_domain: { provider: "RESEND", domain } },
      create: {
        provider: "RESEND",
        domain,
        status: status.providerStatus ?? "unknown",
        spf: status.spf,
        dkim: status.dkim,
        records: status.records as unknown as object,
        checkedById: actor.id,
      },
      update: {
        status: status.providerStatus ?? "unknown",
        spf: status.spf,
        dkim: status.dkim,
        records: status.records as unknown as object,
        checkedAt: new Date(),
        checkedById: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "PROVIDER_DOMAIN_CHECKED",
        actorUserId: actor.id,
        entityType: "ProviderDomainSnapshot",
        entityId: domain,
        toState: status.providerStatus ?? "unknown",
        metadata: {
          domain,
          provider: "RESEND",
          spf: status.spf,
          dkim: status.dkim,
          recordCount: status.records.length,
        },
      },
    });
  });

  return { ok: true, status };
}

export async function getEmailInfrastructure(): Promise<EmailInfrastructureView> {
  await requireCapability("MANAGE_USERS");

  const domainName = productionSendingDomain();
  const stored = await readStoredDomainStatus(domainName);
  const provider = getProductionEmailProvider(stored.status);
  const status = provider.checkConfiguration();
  const origin = publicAppOrigin();
  const replyTo = replyToOrNull();

  const providerFacts: InfrastructureFact[] = [
    {
      label: "Provider selected",
      state: status.name === "RESEND" ? "OK" : "ACTION_REQUIRED",
      detail:
        status.name === "RESEND"
          ? "Resend is the selected production provider."
          : "No production provider is wired. Nothing can be sent to a customer.",
      remedy:
        status.name === "RESEND"
          ? null
          : 'Set PRODUCTION_EMAIL_PROVIDER="resend" in .env.local and restart the server.',
    },
    {
      label: "API key",
      state: status.configured ? "OK" : "ACTION_REQUIRED",
      detail: status.configured
        ? "A Resend API key is present. Its value is never displayed, logged or stored by this platform."
        : "No usable Resend API key is present.",
      remedy: status.configured
        ? null
        : "Create a SENDING-only key at https://resend.com/api-keys, restrict it to axis-gps.com, and put it in .env.local as RESEND_API_KEY. Never paste it into a chat, a commit, or this file's committed template.",
    },
  ];

  const domainFacts: InfrastructureFact[] = [
    {
      label: "Domain verified with Resend",
      state: stored.status.verified
        ? "OK"
        : stored.checkedAt
          ? "ACTION_REQUIRED"
          : "UNKNOWN",
      detail: stored.checkedAt
        ? `Resend reports "${stored.status.providerStatus}" for ${domainName}.`
        : `${domainName} has not been checked with Resend yet.`,
      remedy: stored.status.verified
        ? null
        : "Add the domain in the Resend dashboard, publish every DNS record it lists, then use “Check domain now”. DNS changes can take up to 48 hours.",
    },
    {
      label: "SPF",
      state: mechanismFactState(stored.status.spf),
      detail: mechanismDetail("SPF", stored.status.spf),
      remedy:
        stored.status.spf === "VERIFIED"
          ? null
          : "Publish the SPF record Resend lists. A domain may have only ONE SPF record — merge the include into the existing one; never publish a second.",
    },
    {
      label: "DKIM",
      state: mechanismFactState(stored.status.dkim),
      detail: mechanismDetail("DKIM", stored.status.dkim),
      remedy:
        stored.status.dkim === "VERIFIED"
          ? null
          : "Publish the DKIM record Resend lists, exactly as given — a truncated key silently fails.",
    },
    {
      label: "DMARC",
      state: "UNKNOWN",
      detail:
        "AXIS publishes DMARC itself, so no provider report can confirm it. This platform does not perform DNS lookups.",
      remedy:
        "Publish the p=none record below first and read the reports for a few weeks. Never start at p=reject — unaligned legitimate mail is discarded silently.",
    },
  ];

  const webhookSecretConfigured = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim() !== "";
  const webhookUrl = origin ? `${origin}${RESEND_WEBHOOK_PATH}` : null;

  const webhookFacts: InfrastructureFact[] = [
    {
      label: "Signing secret",
      state: webhookSecretConfigured ? "OK" : "ACTION_REQUIRED",
      detail: webhookSecretConfigured
        ? "A webhook signing secret is present. Every inbound event is verified before it is read."
        : "No signing secret is configured, so every inbound webhook is refused.",
      remedy: webhookSecretConfigured
        ? null
        : "Create the endpoint in the Resend dashboard, copy the signing secret it shows once, and put it in .env.local as RESEND_WEBHOOK_SECRET.",
    },
    {
      label: "Endpoint reachable by Resend",
      state: webhookUrl && !webhookUrl.startsWith("http://localhost") ? "OK" : "UNKNOWN",
      detail: webhookUrl
        ? `Resend must be pointed at ${webhookUrl}.`
        : "No public origin is configured, so no webhook URL can be given to Resend.",
      remedy:
        webhookUrl && !webhookUrl.startsWith("http://localhost")
          ? null
          : "This development machine must NOT be exposed to the internet. Deploy the app to an internal HTTPS host (or a managed platform) and set PUBLIC_APP_URL to that origin. Until then, bounce and complaint events cannot arrive — which is one of several reasons customer sending stays locked.",
    },
  ];

  const unsubscribeReachable = Boolean(
    origin && (origin.startsWith("https://") || origin.startsWith("http://localhost")),
  );

  const productionFacts: InfrastructureFact[] = [
    {
      label: "Customer sending",
      state: productionDeliveryEnabled() ? "OK" : "LOCKED",
      detail: productionDeliveryEnabled()
        ? "PRODUCTION_DELIVERY_ENABLED is true. Real customer delivery is permitted."
        : "PRODUCTION_DELIVERY_ENABLED is false. No customer email can leave this platform.",
      remedy: null,
    },
    {
      label: "Internal provider pilot",
      state: providerPilotEnabled() ? "OK" : "LOCKED",
      detail: providerPilotEnabled()
        ? "One internal pilot email may be sent through Resend, to khaled-s@axis-gps.com only."
        : "The internal provider pilot is off.",
      remedy: null,
    },
    {
      label: "Where these switches live",
      state: "OK",
      detail:
        "Both are environment variables read at server start. They are not in the database, and no page — including this one — can write them, so no signed-in role can enable sending from a browser.",
      remedy: null,
    },
  ];

  return {
    provider: {
      name: status.name,
      configured: status.configured,
      keyLocation: ".env.local (git-ignored, never committed)",
      facts: providerFacts,
    },
    sender: {
      productionFrom: `${PRODUCTION_SENDER_NAME} <${PRODUCTION_SENDER_EMAIL}>`,
      productionReplyTo: replyTo,
      safeTestFrom: "axisgpscana@gmail.com",
      safeTestTo: "khaled-s@axis-gps.com",
    },
    domain: {
      ...stored.status,
      lastCheckedAt: stored.checkedAt,
      facts: domainFacts,
      records: stored.status.records,
    },
    dmarc: recommendDmarc(domainName, `dmarc@${domainName}`),
    // No DNS lookup is performed, so the existing record is unknown. The guidance says
    // so rather than pretending the domain has none.
    spf: planSpfMerge(null, RESEND_SPF_INCLUDE),
    webhook: {
      path: RESEND_WEBHOOK_PATH,
      url: webhookUrl,
      secretConfigured: webhookSecretConfigured,
      facts: webhookFacts,
    },
    publicUnsubscribe: {
      origin,
      reachable: unsubscribeReachable,
      facts: [
        {
          label: "Public unsubscribe endpoint",
          state: unsubscribeReachable ? "OK" : "ACTION_REQUIRED",
          detail: origin
            ? `Unsubscribe links point at ${origin}/unsubscribe.`
            : "No public origin is configured, so unsubscribe links cannot be built.",
          remedy: unsubscribeReachable
            ? null
            : "Set PUBLIC_APP_URL to a publicly-reachable HTTPS origin. A newsletter is opened days later on someone else's network, so a link to localhost is a broken promise.",
        },
      ],
    },
    productionSending: {
      enabled: productionDeliveryEnabled(),
      pilotEnabled: providerPilotEnabled(),
      facts: productionFacts,
    },
  };
}

function mechanismFactState(state: DomainAuthStatus["spf"]): FactState {
  if (state === "VERIFIED") return "OK";
  if (state === "UNKNOWN") return "UNKNOWN";
  return "ACTION_REQUIRED";
}

function mechanismDetail(name: string, state: DomainAuthStatus["spf"]): string {
  switch (state) {
    case "VERIFIED":
      return `Resend reports ${name} as verified.`;
    case "NOT_VERIFIED":
      return `Resend reports ${name} as NOT verified.`;
    default:
      return `${name} has not been checked.`;
  }
}
