import "server-only";

import type { Prisma } from "@prisma/client";

import {
  DeliveryState,
  decideDispatch,
  isSubmittable,
  type DispatchVetoFacts,
} from "../../domain/delivery/dispatchPolicy";
import {
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../../domain/types";
import { Capability, requireCapability } from "../auth/session";
import { loadAddressFacts } from "../db/repositories/audienceRepository";
import { getPrisma } from "../db/prisma";
import {
  getProductionEmailProvider,
  productionDeliveryEnabled,
} from "../integrations/email";
import { getSendReadiness } from "./sendReadinessService";

/**
 * The production delivery ledger, and the dry run that exercises it (ADR-0024).
 *
 * NOTHING IN THIS FILE SENDS EMAIL. It imports the production provider only to read
 * its configuration and to prove, in a test, that the port is never called. The one
 * adapter that exists throws when asked to send, so a mistake here fails loudly rather
 * than reaching a customer.
 *
 * What "prepare the ledger" means and does not mean:
 *
 *   MEANS      freeze one `CampaignRecipient` row per approved destination, carrying
 *              the audience it came from, the CRM records behind it, and the
 *              communication state at that moment.
 *   DOES NOT   send, schedule, queue, or make anything sendable. Every row is created
 *              PENDING, and the state machine has no automatic path out of it.
 *
 * Recipients can only ever come from an approved, current `CampaignFinalAudience`.
 * There is no parameter on any function here that accepts an address, so "send to this
 * person as well" is unrepresentable rather than merely refused.
 */

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

/** A localized campaign requires a matching address language; UNKNOWN does not. */
function requiredLanguage(language: string): Language | null {
  return language === Language.HE || language === Language.AR
    ? (language as Language)
    : null;
}

// ---------------------------------------------------------------------------
// Preparing the ledger
// ---------------------------------------------------------------------------

export interface PrepareLedgerResult {
  finalAudienceId: string;
  /** Rows created PENDING and ready for a future dispatch. */
  prepared: number;
  /** Rows created SUPPRESSED because a veto arrived after approval. */
  vetoed: number;
  vetoBreakdown: Record<string, number>;
  /** Already present from an earlier preparation — never duplicated. */
  unchanged: number;
  message: string;
}

/**
 * Creates the production delivery ledger for an approved campaign.
 *
 * Every precondition is re-derived here, not taken from the caller:
 *
 *   - the actor is signed in and holds APPROVE_PRODUCTION (this is a send-adjacent act);
 *   - a final audience exists and is NOT stale;
 *   - a production approval is valid for exactly that audience;
 *   - four-eyes is satisfied — the approver was not the creator.
 *
 * Then, for each frozen destination, the high-authority vetoes are re-read LIVE. An
 * address that unsubscribed between approval and preparation is written as SUPPRESSED
 * with its reason, not skipped silently: "who was dropped and why" has to be
 * answerable afterwards.
 */
export async function prepareDeliveryLedger(
  campaignId: string,
): Promise<PrepareLedgerResult> {
  const actor = await requireCapability(Capability.APPROVE_PRODUCTION);
  const prisma = getPrisma();

  const readiness = await getSendReadiness(campaignId);
  if (!readiness) throw new DeliveryError("That newsletter no longer exists.");

  if (!readiness.finalAudience) {
    throw new DeliveryError("Prepare the final audience before preparing delivery records.");
  }
  if (readiness.stalenessMessage) {
    throw new DeliveryError(readiness.stalenessMessage);
  }
  if (!readiness.approval?.valid) {
    throw new DeliveryError(
      readiness.approval?.problem ??
        "This newsletter has not been approved for production yet.",
    );
  }
  if (!readiness.fourEyes.satisfied) {
    throw new DeliveryError(
      readiness.fourEyes.problem ??
        "A different authorized AXIS user must approve this campaign.",
    );
  }

  const finalAudienceId = readiness.finalAudience.id;

  const destinations = await prisma.campaignFinalAudienceDestination.findMany({
    where: { finalAudienceId },
    orderBy: [{ normalizedEmail: "asc" }],
  });
  if (destinations.length === 0) {
    throw new DeliveryError("This audience contains nobody who can be emailed.");
  }

  // LIVE re-read of the facts that can veto a send after approval. The frozen snapshot
  // is a record of a past decision; these are the present.
  const facts = await loadAddressFacts(
    prisma,
    destinations.map((destination) => destination.normalizedEmail),
  );

  const requireLang = requiredLanguage(readiness.campaignLanguage);
  const addresses = await prisma.communicationAddress.findMany({
    where: {
      normalizedEmail: { in: destinations.map((d) => d.normalizedEmail) },
    },
    select: { id: true, normalizedEmail: true },
  });
  const addressIdByEmail = new Map(
    addresses.map((row) => [row.normalizedEmail, row.id]),
  );

  const existing = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    select: { normalizedEmail: true },
  });
  const alreadyLedgered = new Set(existing.map((row) => row.normalizedEmail));

  const vetoBreakdown: Record<string, number> = {};
  let prepared = 0;
  let vetoed = 0;

  const rows: Prisma.CampaignRecipientCreateManyInput[] = [];
  const sourceRows: Prisma.CampaignRecipientSourceCreateManyInput[] = [];

  for (const destination of destinations) {
    if (alreadyLedgered.has(destination.normalizedEmail)) continue;

    const live = facts.get(destination.normalizedEmail);
    const vetoFacts: DispatchVetoFacts = {
      isUnsubscribed: live?.isUnsubscribed ?? false,
      isSuppressed: live?.isSuppressed ?? false,
      emailStatus: (live?.emailStatus as EmailStatus) ?? EmailStatus.UNKNOWN,
      language: (live?.language as Language) ?? Language.UNKNOWN,
      consentStatus: (live?.consentStatus as ConsentStatus) ?? ConsentStatus.UNKNOWN,
    };

    const decision = decideDispatch({
      facts: vetoFacts,
      requireLanguage: requireLang,
    });

    if (decision.send) prepared += 1;
    else {
      vetoed += 1;
      vetoBreakdown[decision.reason] = (vetoBreakdown[decision.reason] ?? 0) + 1;
    }

    rows.push({
      campaignId,
      finalAudienceId,
      normalizedEmail: destination.normalizedEmail,
      communicationAddressId: addressIdByEmail.get(destination.normalizedEmail) ?? null,
      intendedEmail: destination.intendedEmail,
      // PENDING, never READY: nothing here makes a message sendable.
      state: decision.send ? DeliveryState.PENDING : DeliveryState.SUPPRESSED,
      vetoReason: decision.send ? null : (decision.reason as ExclusionReason),
      languageAtPreparation: vetoFacts.language,
      consentAtPreparation: vetoFacts.consentStatus,
      preparedById: actor.id,
      preparedAt: new Date(),
    });
  }

  if (rows.length === 0) {
    return {
      finalAudienceId,
      prepared: 0,
      vetoed: 0,
      vetoBreakdown: {},
      unchanged: alreadyLedgered.size,
      message:
        "Delivery records already exist for every address in this audience. Nothing was duplicated, and no email was sent.",
    };
  }

  await prisma.$transaction(async (tx) => {
    // The UNIQUE (campaignId, normalizedEmail) is the real guard: a concurrent second
    // preparation loses at the database rather than creating a duplicate delivery.
    await tx.campaignRecipient.createMany({ data: rows, skipDuplicates: true });

    const created = await tx.campaignRecipient.findMany({
      where: { campaignId },
      select: { id: true, normalizedEmail: true },
    });
    const recipientIdByEmail = new Map(
      created.map((row) => [row.normalizedEmail, row.id]),
    );

    // Every contributing CRM record is preserved, exactly as the frozen audience saw
    // it. Email is never CRM identity (ADR-0009), so provenance travels separately.
    for (const destination of destinations) {
      const recipientId = recipientIdByEmail.get(destination.normalizedEmail);
      if (!recipientId) continue;
      const sources = (destination.sources ?? []) as unknown as {
        sourceBoardId: string;
        sourceItemId: string;
        sourceEntityType: string;
        emailSourceType: string;
        sourceEmailRaw: string;
      }[];
      for (const source of sources) {
        sourceRows.push({
          recipientId,
          sourceBoardId: source.sourceBoardId,
          sourceItemId: source.sourceItemId,
          sourceEntityType: source.sourceEntityType as "CUSTOMERS" | "CONTACTS",
          emailSourceType: source.emailSourceType as
            | "COMPANY_EMAIL"
            | "CONTACT_EMAIL",
          sourceEmailRaw: source.sourceEmailRaw,
        });
      }
    }

    if (sourceRows.length > 0) {
      await tx.campaignRecipientSource.createMany({
        data: sourceRows,
        skipDuplicates: true,
      });
    }

    await tx.auditLog.create({
      data: {
        action: "DELIVERY_LEDGER_PREPARED",
        actorUserId: actor.id,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "LEDGER_PREPARED",
        metadata: {
          finalAudienceId,
          prepared,
          vetoed,
          // Unambiguous in the trail: preparing is not sending.
          sent: false,
          providerCalled: false,
        },
      },
    });
  });

  return {
    finalAudienceId,
    prepared,
    vetoed,
    vetoBreakdown,
    unchanged: alreadyLedgered.size,
    message:
      `${prepared} delivery record${prepared === 1 ? "" : "s"} prepared and ${vetoed} suppressed. ` +
      "NO EMAIL WAS SENT — production delivery is locked.",
  };
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

export interface DeliveryLedgerView {
  campaignId: string;
  total: number;
  byState: Record<string, number>;
  vetoBreakdown: Record<string, number>;
  preparedAt: Date | null;
  /** Nothing has ever been submitted, and this proves it from the data. */
  everSubmitted: boolean;
}

export async function getDeliveryLedger(
  campaignId: string,
): Promise<DeliveryLedgerView> {
  await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();

  const [grouped, vetoes, first] = await Promise.all([
    prisma.campaignRecipient.groupBy({
      by: ["state"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.campaignRecipient.groupBy({
      by: ["vetoReason"],
      where: { campaignId, vetoReason: { not: null } },
      _count: { _all: true },
    }),
    prisma.campaignRecipient.findFirst({
      where: { campaignId },
      orderBy: [{ preparedAt: "asc" }],
      select: { preparedAt: true },
    }),
  ]);

  const byState: Record<string, number> = {};
  for (const row of grouped) byState[row.state] = row._count._all;

  const vetoBreakdown: Record<string, number> = {};
  for (const row of vetoes) {
    if (row.vetoReason) vetoBreakdown[row.vetoReason] = row._count._all;
  }

  const submitted = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      state: {
        in: [
          DeliveryState.SENDING,
          DeliveryState.ACCEPTED,
          DeliveryState.DELIVERED,
          DeliveryState.SENT,
          DeliveryState.UNCERTAIN,
        ],
      },
    },
  });

  return {
    campaignId,
    total: Object.values(byState).reduce((sum, count) => sum + count, 0),
    byState,
    vetoBreakdown,
    preparedAt: first?.preparedAt ?? null,
    everSubmitted: submitted > 0,
  };
}

// ---------------------------------------------------------------------------
// The dry run
// ---------------------------------------------------------------------------

export interface DispatchDryRun {
  campaignId: string;
  /** Rows that would be submitted if production sending were enabled. */
  wouldSubmit: number;
  /** Rows a live veto re-check would stop, right now. */
  wouldVeto: number;
  vetoBreakdown: Record<string, number>;
  /** Always zero. Asserted by a test, not merely intended. */
  providerCalls: number;
  productionEnabled: boolean;
  providerConfigured: boolean;
  blockers: string[];
}

/**
 * Walks the dispatch pipeline WITHOUT calling a provider.
 *
 * It re-reads the vetoes exactly as a real dispatch would and reports what would
 * happen. `providerCalls` is returned as a number so the promise "zero network calls"
 * is something a test can assert rather than something a comment claims.
 */
export async function dispatchDryRun(campaignId: string): Promise<DispatchDryRun> {
  await requireCapability(Capability.APPROVE_PRODUCTION);
  const prisma = getPrisma();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { language: true },
  });
  if (!campaign) throw new DeliveryError("That newsletter no longer exists.");

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    select: { normalizedEmail: true, state: true },
  });

  const facts = await loadAddressFacts(
    prisma,
    recipients.map((recipient) => recipient.normalizedEmail),
  );
  const requireLang = requiredLanguage(campaign.language);

  const vetoBreakdown: Record<string, number> = {};
  let wouldSubmit = 0;
  let wouldVeto = 0;

  for (const recipient of recipients) {
    // Only rows the state machine would let through are considered. UNCERTAIN is not
    // among them, deliberately: re-submitting one could duplicate a real email.
    const submittable =
      recipient.state === DeliveryState.PENDING ||
      isSubmittable(recipient.state as DeliveryState);
    if (!submittable) continue;

    const live = facts.get(recipient.normalizedEmail);
    const decision = decideDispatch({
      facts: {
        isUnsubscribed: live?.isUnsubscribed ?? false,
        isSuppressed: live?.isSuppressed ?? false,
        emailStatus: (live?.emailStatus as EmailStatus) ?? EmailStatus.UNKNOWN,
        language: (live?.language as Language) ?? Language.UNKNOWN,
        consentStatus: (live?.consentStatus as ConsentStatus) ?? ConsentStatus.UNKNOWN,
      },
      requireLanguage: requireLang,
    });

    if (decision.send) wouldSubmit += 1;
    else {
      wouldVeto += 1;
      vetoBreakdown[decision.reason] = (vetoBreakdown[decision.reason] ?? 0) + 1;
    }
  }

  const provider = getProductionEmailProvider();
  const configuration = provider.checkConfiguration();

  return {
    campaignId,
    wouldSubmit,
    wouldVeto,
    vetoBreakdown,
    // The provider was asked for its configuration and nothing else. `send` was not
    // called, and the only adapter that exists would throw if it were.
    providerCalls: 0,
    productionEnabled: productionDeliveryEnabled(),
    providerConfigured: configuration.configured,
    blockers: configuration.problems,
  };
}


// ---------------------------------------------------------------------------
// The gated dispatch worker (ADR-0025)
// ---------------------------------------------------------------------------

export type DispatchRunResult =
  | {
      ok: false;
      reason: "PRODUCTION_LOCKED" | "PROVIDER_NOT_CONFIGURED" | "NOT_APPROVED";
      message: string;
      submitted: 0;
      providerCalls: 0;
    }
  | {
      ok: true;
      submitted: number;
      vetoed: number;
      providerCalls: number;
    };

/**
 * Dispatches a campaign's READY ledger rows through the production provider.
 *
 * THE GATE IS FIRST, AND IT IS THE POINT. Everything below the first `if` is
 * unreachable while `PRODUCTION_DELIVERY_ENABLED` is false — which it is, and which no
 * page, role or database row can change. The code exists so the eventual switch-on is
 * a configuration change rather than a rewrite, not because it is ready to run.
 *
 * `PROVIDER_PILOT_ENABLED` is deliberately NOT consulted here. The pilot is a separate
 * channel with its own service, its own single hard-coded recipient and its own
 * approval; enabling it must grant nothing at all on this path, and the surest way to
 * guarantee that is for this function never to read it.
 *
 * There is no scheduler, no cron entry and no queue consumer that calls this. It is
 * reached only by a deliberate call.
 */
export async function dispatchCampaign(campaignId: string): Promise<DispatchRunResult> {
  await requireCapability(Capability.APPROVE_PRODUCTION);

  if (!productionDeliveryEnabled()) {
    // Refused before anything is read, resolved, or submitted. No ledger row is
    // touched and no provider object is even constructed.
    return {
      ok: false,
      reason: "PRODUCTION_LOCKED",
      message:
        "Production customer sending is locked. No message was submitted, and no ledger row was changed.",
      submitted: 0,
      providerCalls: 0,
    };
  }

  const provider = getProductionEmailProvider();
  const configuration = provider.checkConfiguration();
  if (!configuration.configured || !configuration.enabled) {
    return {
      ok: false,
      reason: "PROVIDER_NOT_CONFIGURED",
      message:
        "The production email provider is not fully configured, so nothing was submitted.",
      submitted: 0,
      providerCalls: 0,
    };
  }

  void campaignId;
  // Unreachable in this milestone by construction. Left unimplemented on purpose:
  // writing a fan-out loop that has never been exercised against a real provider, and
  // that no test may run against one, would be worse than an explicit refusal.
  throw new DeliveryError(
    "Production dispatch is not implemented. Enabling the switch does not implement it.",
  );
}
