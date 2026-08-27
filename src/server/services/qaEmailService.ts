import "server-only";

import { randomUUID } from "node:crypto";

import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterDocument,
  type NewsletterItem,
} from "../../domain/email/newsletterTemplate";
import {
  QA_ALLOWED_RECIPIENTS,
  QA_BLOCKER_MESSAGE,
  QA_HARD_PER_RECIPIENT,
  QA_HARD_TOTAL,
  applyQaSubjectPrefix,
  assertSafeQaEnvelope,
  isWithinQaCaps,
  qaNoticeFor,
  type QaBlocker,
  type QaRecipient,
} from "../../domain/send/qaPolicy";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import * as ledger from "../db/repositories/qaLedgerRepository";
import { findOpenRunForSending } from "../db/repositories/qaLedgerRepository";
import {
  getQaEmailProvider,
  qaEmailEnabled,
} from "../integrations/email/qaEmailProvider";
import { getSenderIdentity } from "../integrations/email/senderIdentity";
import { getNewsletterBrand } from "./brandConfig";
import { publicUrlForCampaignNamed } from "./publicNewsletterService";
import { QA_SCENARIOS, type QaScenario, type QaScenarioId } from "./qaScenarios";

/**
 * Internal QA email (ADR-0027).
 *
 * Each send exercises ONE named rendering behaviour against ONE of four approved
 * internal addresses. It is not a newsletter, not a campaign, and not a customer send.
 *
 * The recipient comes ONLY from `QA_ALLOWED_RECIPIENTS` — a hard-coded constant. This
 * file never reads `CommunicationAddress`, `Contact`, `Company`, `Segment`,
 * `CampaignRecipient` or any final audience, and a test asserts that against the
 * source. There is no code path from CRM data to a QA envelope.
 *
 * Caps are enforced HERE, server-side, against the ledger — not by the caller
 * counting. A runaway loop is refused at the hard limit rather than warned about.
 */

export interface QaSendRequest {
  scenarioId: string;
  /** Must be one of the four. Validated, never trusted. */
  recipient: string;
}

export interface QaSendOutcome {
  ok: boolean;
  testId: string;
  scenarioId: string;
  scenarioTitle: string;
  recipient: string;
  subject: string;
  purpose: string;
  outcome: "ACCEPTED" | "FAILED" | "UNCERTAIN" | "REFUSED";
  providerMessageId: string | null;
  acceptedAt: Date | null;
  message: string;
  /** Provider network calls this request made. Zero for every refusal. */
  providerCalls: number;
}

// ---------------------------------------------------------------------------
// Rendering one QA scenario
// ---------------------------------------------------------------------------

function documentFor(
  scenario: QaScenario,
  viewInBrowserUrl: string | null,
): NewsletterDocument {
  const brand = getNewsletterBrand();

  const items: NewsletterItem[] = scenario.items.map((item) => ({
    title: item.title,
    summary: item.summary ?? null,
    bodyHtml: item.bodyHtml ?? null,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt ?? null,
    externalUrl: item.externalUrl ?? null,
    kicker: item.kicker ?? null,
  }));

  return {
    // Every QA subject carries the prefix, applied once.
    subject: applyQaSubjectPrefix(scenario.subject),
    preheader: scenario.preheader ?? null,
    language: scenario.language,
    introHtml: scenario.introHtml ?? null,
    items,
    brand,
    // Already resolved through the deliverability gate by the caller, so this is
    // either a URL a recipient can actually open, or null.
    viewInBrowserUrl,
    // The same inert placeholder a SAFE TEST carries: a QA email must unsubscribe
    // nobody, and the footer must look exactly as it does in production.
    unsubscribeUrl: null,
    isTestMode: true,
    // QA ONLY. No production or SAFE TEST document sets this.
    qaNotice: qaNoticeFor(scenario.language),
  };
}

export interface RenderedQaEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders one scenario.
 *
 * `viewInBrowserUrl` must already have passed the deliverability gate — this
 * function does no resolution and no validation of its own, exactly like the
 * production path, so there is only one place that decides whether a link is safe
 * to print. Defaults to null: almost every scenario has no web version.
 */
export function renderQaScenario(
  scenario: QaScenario,
  viewInBrowserUrl: string | null = null,
): RenderedQaEmail {
  const document = documentFor(scenario, viewInBrowserUrl);
  return {
    subject: document.subject,
    html: renderNewsletterHtml(document),
    text: renderNewsletterText(document),
  };
}

// ---------------------------------------------------------------------------
// Availability & caps
// ---------------------------------------------------------------------------

export interface QaStatus {
  enabled: boolean;
  transportConfigured: boolean;
  transportProblems: string[];
  senderEmail: string | null;
  replyToEmail: string | null;
  senderName: string;
  allowedRecipients: readonly string[];
  totalSent: number;
  perRecipient: Record<string, number>;
  hardTotal: number;
  hardPerRecipient: number;
  blockers: QaBlocker[];
  message: string;
  /** The open live run, if any. A send requires one. */
  openRunId: string | null;
  openRunLabel: string | null;
}

/**
 * Quota is computed from the DURABLE ledger, LIVE rows only (ADR-0028).
 *
 * It counts every live send ever made, not the current run's — opening a new run must
 * not hand back quota, which is exactly what the deleted-ledger incident did by
 * accident.
 */
async function countsFromLedger(): Promise<{
  total: number;
  perRecipient: Record<string, number>;
}> {
  const counts = await ledger.countLiveSends();
  const perRecipient: Record<string, number> = {};
  for (const address of QA_ALLOWED_RECIPIENTS) {
    perRecipient[address] = counts.perRecipient[address] ?? 0;
  }
  return { total: counts.total, perRecipient };
}

export async function getQaStatus(): Promise<QaStatus> {
  await requireCapability(Capability.SEND_TEST_EMAIL);

  const provider = getQaEmailProvider();
  const configuration = provider.checkConfiguration();
  const identity = getSenderIdentity();
  const counts = await countsFromLedger();

  const openRun = await findOpenRunForSending();

  const blockers: QaBlocker[] = [];
  if (!qaEmailEnabled()) blockers.push("QA_MODE_OFF");
  if (!configuration.configured) blockers.push("TRANSPORT_NOT_CONFIGURED");
  if (counts.total >= QA_HARD_TOTAL) blockers.push("CAP_REACHED");
  if (!openRun) blockers.push("NO_OPEN_RUN");

  return {
    enabled: qaEmailEnabled(),
    transportConfigured: configuration.configured,
    transportProblems: configuration.problems,
    senderEmail: configuration.senderEmail,
    replyToEmail: configuration.replyToEmail,
    senderName: identity.senderName,
    allowedRecipients: QA_ALLOWED_RECIPIENTS,
    totalSent: counts.total,
    perRecipient: counts.perRecipient,
    hardTotal: QA_HARD_TOTAL,
    hardPerRecipient: QA_HARD_PER_RECIPIENT,
    openRunId: openRun?.id ?? null,
    openRunLabel: openRun?.label ?? null,
    blockers,
    message:
      blockers.length === 0
        ? `Ready. QA email can reach only these ${QA_ALLOWED_RECIPIENTS.length} internal addresses.`
        : QA_BLOCKER_MESSAGE[blockers[0]],
  };
}

// ---------------------------------------------------------------------------
// Sending one QA message
// ---------------------------------------------------------------------------

/**
 * Sends ONE QA email.
 *
 * Order matters and is the whole safety design:
 *   1. permission;
 *   2. the recipient is forced through the allowlist gate — a refusal returns here,
 *      with `providerCalls: 0`, before a provider object is even obtained;
 *   3. the caps are re-read from the ledger;
 *   4. a ledger row is written BEFORE the network call, so a crash mid-send still
 *      leaves evidence;
 *   5. the adapter validates the recipient a second time, independently.
 */
export async function sendQaEmail(request: QaSendRequest): Promise<QaSendOutcome> {
  const actor = await requireCapability(Capability.SEND_TEST_EMAIL);
  const testId = randomUUID().slice(0, 8).toUpperCase();

  const scenario = QA_SCENARIOS.find((s) => s.id === request.scenarioId);
  const base = {
    testId,
    scenarioId: request.scenarioId,
    scenarioTitle: scenario?.title ?? "(unknown scenario)",
    recipient: typeof request.recipient === "string" ? request.recipient : "(invalid)",
    subject: "",
    purpose: scenario?.purpose ?? "",
    providerMessageId: null,
    acceptedAt: null,
    providerCalls: 0,
  };

  if (!scenario) {
    return {
      ...base,
      ok: false,
      outcome: "REFUSED",
      message: "That QA scenario does not exist.",
    };
  }

  // ---- THE GATE. Nothing below runs for a rejected address, and no provider object
  // is obtained, so `providerCalls` is structurally zero for every refusal.
  let recipient: QaRecipient;
  try {
    recipient = assertSafeQaEnvelope({ to: request.recipient });
  } catch (error) {
    return {
      ...base,
      ok: false,
      outcome: "REFUSED",
      message: error instanceof Error ? error.message : "That recipient is not allowed.",
    };
  }

  if (!qaEmailEnabled()) {
    return { ...base, recipient, ok: false, outcome: "REFUSED", message: QA_BLOCKER_MESSAGE.QA_MODE_OFF };
  }

  // A send requires an OPEN run. There is no implicit run creation anywhere — a
  // restart, a test, or a toggled environment variable must never make one appear.
  // Checked BEFORE the transport and the caps: "nobody started a QA campaign" is a
  // more fundamental refusal than "the transport is misconfigured".
  const openRun = await findOpenRunForSending();
  if (!openRun) {
    return {
      ...base,
      recipient,
      ok: false,
      outcome: "REFUSED",
      message: QA_BLOCKER_MESSAGE.NO_OPEN_RUN,
    };
  }

  // ---- Caps, re-read from the ledger rather than trusted from a caller.
  const counts = await countsFromLedger();
  if (
    !isWithinQaCaps({
      totalSent: counts.total,
      sentToRecipient: counts.perRecipient[recipient] ?? 0,
    })
  ) {
    return {
      ...base,
      recipient,
      ok: false,
      outcome: "REFUSED",
      message: `${QA_BLOCKER_MESSAGE.CAP_REACHED} (total ${counts.total}/${QA_HARD_TOTAL}, this address ${counts.perRecipient[recipient] ?? 0}/${QA_HARD_PER_RECIPIENT})`,
    };
  }

  // The hosted web version, when this scenario demonstrates one. `publicUrlForCampaignNamed`
  // applies the ordinary deliverability rule, so a development origin yields null and
  // the link is omitted rather than shipped dead.
  const webVersionUrl = scenario.webVersionCampaignName
    ? await publicUrlForCampaignNamed(scenario.webVersionCampaignName)
    : null;

  const rendered = renderQaScenario(scenario, webVersionUrl);

  // Belt and braces: the subject must carry the prefix, checked again with the address.
  assertSafeQaEnvelope({ to: recipient, subject: rendered.subject });

  const provider = getQaEmailProvider();
  const configuration = provider.checkConfiguration();
  if (!configuration.configured) {
    return {
      ...base,
      recipient,
      subject: rendered.subject,
      ok: false,
      outcome: "REFUSED",
      message: QA_BLOCKER_MESSAGE.TRANSPORT_NOT_CONFIGURED,
    };
  }

  const idempotencyKey = randomUUID();

  // ---- Durable evidence BEFORE the network call. LIVE, and therefore carrying no
  // fixture owner, so no cleanup routine can reach it.
  const row = await ledger.createSend({
    runId: openRun.id,
    // The send inherits the RUN's origin. A fixture run (test-runner only) produces
    // fixture rows: cleanable, and invisible to the quota that guards real inboxes.
    origin: openRun.origin,
    fixtureOwner: openRun.fixtureOwner,
    recipient,
    subject: rendered.subject,
    scenarioId: scenario.id,
    purpose: scenario.purpose,
    provider: "GMAIL_QA",
    requestedById: actor.id,
  });

  const result = await provider.send({
    to: recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  });

  const state =
    result.outcome === "ACCEPTED"
      ? "ACCEPTED"
      : result.outcome === "UNCERTAIN"
        ? "UNCERTAIN"
        : "FAILED";
  const acceptedAt = result.outcome === "ACCEPTED" ? new Date() : null;

  // Written once. `recordResult` refuses a row that already carries a provider id.
  //
  // A duplicate id from the provider is possible in principle, and the UNIQUE index
  // refuses it. That is treated as UNCERTAIN rather than allowed to escape: the
  // message may well have gone out, the attempt row stays in a quota-consuming state,
  // and nothing is retried.
  try {
    await ledger.recordResult({
      id: row.id,
      state,
      providerMessageId: result.providerMessageId ?? null,
      failureCode: result.failureCode ?? null,
      failureReason: result.message ?? null,
      acceptedAt,
    });
  } catch {
    await ledger.recordResult({
      id: row.id,
      state: "UNCERTAIN",
      failureCode: "LEDGER_CONFLICT",
      failureReason:
        "The provider returned a message id that is already recorded, so this attempt could not be confirmed. Check the Sent folder before sending again.",
    });
    return {
      testId,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      recipient,
      subject: rendered.subject,
      purpose: scenario.purpose,
      ok: false,
      outcome: "UNCERTAIN",
      providerMessageId: null,
      acceptedAt: null,
      message:
        "The provider returned a message id that is already recorded. This attempt could not be confirmed and will not be retried automatically.",
      providerCalls: 1,
    };
  }

  await getPrisma().auditLog.create({
    data: {
      action: "QA_EMAIL_SENT",
      actorUserId: actor.id,
      entityType: "QaEmailSend",
      entityId: row.id,
      toState: state,
      metadata: {
        testId,
        scenarioId: scenario.id,
        runId: openRun.id,
        toEmail: recipient,
        subject: rendered.subject,
        providerMessageId: result.providerMessageId ?? null,
        // Provable from the audit trail that no customer was involved.
        derivedFromCrm: false,
        cc: 0,
        bcc: 0,
      },
    },
  });

  return {
    testId,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    recipient,
    subject: rendered.subject,
    purpose: scenario.purpose,
    ok: result.outcome === "ACCEPTED",
    outcome: result.outcome,
    providerMessageId: result.providerMessageId ?? null,
    acceptedAt,
    message: result.message ?? "",
    providerCalls: 1,
  };
}

/** The full durable QA ledger, for the report and the screen. */
export async function listQaSends() {
  await requireCapability(Capability.SEND_TEST_EMAIL);
  return ledger.listSends();
}

export { QA_SCENARIOS };
export type { QaScenarioId };
