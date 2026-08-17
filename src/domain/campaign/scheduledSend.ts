/**
 * Pure scheduled-send eligibility + automation draft factory (ADR-0010).
 *
 * A scheduled/automation-prepared campaign is NEVER sendable to production
 * unless it is approved (four-eyes), its content is ready, the scheduled time is
 * reached, and production mode is explicitly enabled. If the time arrives while
 * unapproved: DO NOT SEND (reason NOT_APPROVED) — never silently send late.
 * Recipient unsubscribe/suppression is re-evaluated separately at send time via
 * the eligibility/audience pipeline (see resolveAudience / evaluateEligibility).
 */

export type ScheduledSendReason =
  | "NOT_APPROVED"
  | "CONTENT_NOT_READY"
  | "TIME_NOT_REACHED"
  | "PRODUCTION_DISABLED";

export interface ScheduledSendInput {
  approved: boolean;
  contentReady: boolean;
  scheduledAt: number | null; // epoch ms; null = not scheduled
  now: number; // epoch ms
  productionEnabled: boolean; // SEND_MODE === PRODUCTION (explicit admin action)
}

export type ScheduledSendResult =
  | { sendable: true }
  | { sendable: false; reason: ScheduledSendReason };

export function evaluateScheduledSend(input: ScheduledSendInput): ScheduledSendResult {
  if (!input.approved) return { sendable: false, reason: "NOT_APPROVED" };
  if (!input.contentReady) return { sendable: false, reason: "CONTENT_NOT_READY" };
  if (input.scheduledAt === null || input.now < input.scheduledAt) {
    return { sendable: false, reason: "TIME_NOT_REACHED" };
  }
  if (!input.productionEnabled) return { sendable: false, reason: "PRODUCTION_DISABLED" };
  return { sendable: true };
}

// ---------------------------------------------------------------------------
// Automation prepares a DRAFT campaign requiring human review + approval.
// It selects NO content and sends NOTHING (default TEST mode, not approved).
// ---------------------------------------------------------------------------
export type CampaignLanguage = "HE" | "AR" | "UNKNOWN";

export interface AutomationForDraft {
  id: string;
  name: string;
  language: CampaignLanguage;
  segmentId?: string | null;
}

export interface DraftCampaign {
  name: string;
  language: CampaignLanguage;
  status: "DRAFT";
  sendMode: "TEST";
  approved: false;
  segmentId: string | null;
  automationId: string;
  scheduledForIso: string;
}

export function buildAutomationDraftCampaign(
  a: AutomationForDraft,
  scheduledForIso: string,
): DraftCampaign {
  return {
    name: `${a.name} — ${scheduledForIso}`,
    language: a.language,
    status: "DRAFT",
    sendMode: "TEST",
    approved: false,
    segmentId: a.segmentId ?? null,
    automationId: a.id,
    scheduledForIso,
  };
}
