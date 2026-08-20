/**
 * Deterministic send-readiness evaluation (ADR-0022).
 *
 * One pure function turns a description of the campaign's current state into an
 * ordered checklist. It is the single place that decides what "ready" means, so the
 * readiness page, any future send workflow, and the tests all agree by construction
 * rather than by convention.
 *
 * Three outcomes, and the difference matters:
 *
 *   READY    nothing to do.
 *   WARNING  worth a human's attention, but it does not stop a send.
 *   BLOCKED  a send must not happen. Any BLOCKED check makes the campaign not ready.
 *
 * This function grants nothing. It cannot enable production sending, and the
 * infrastructure check below is hard-wired to BLOCKED for exactly that reason:
 * production delivery is not implemented, and a checklist that could report otherwise
 * would be lying.
 *
 * Pure: no I/O, no framework imports, no clock of its own.
 */

export const ReadinessStatus = {
  READY: "READY",
  WARNING: "WARNING",
  BLOCKED: "BLOCKED",
} as const;
export type ReadinessStatus = (typeof ReadinessStatus)[keyof typeof ReadinessStatus];

export const ReadinessGroup = {
  CONTENT: "CONTENT",
  AUDIENCE: "AUDIENCE",
  COMMUNICATION: "COMMUNICATION",
  APPROVAL: "APPROVAL",
  INFRASTRUCTURE: "INFRASTRUCTURE",
} as const;
export type ReadinessGroup = (typeof ReadinessGroup)[keyof typeof ReadinessGroup];

export const READINESS_GROUP_LABEL: Record<ReadinessGroup, string> = {
  CONTENT: "Content",
  AUDIENCE: "Audience",
  COMMUNICATION: "Communication rules",
  APPROVAL: "Approval",
  INFRASTRUCTURE: "Sending",
};

export interface ReadinessCheck {
  key: string;
  group: ReadinessGroup;
  /** Short label shown in the checklist. */
  label: string;
  status: ReadinessStatus;
  /** One sentence a non-technical person can act on. Never a raw code. */
  detail: string;
}

export interface ReadinessInput {
  campaign: {
    status: string;
    subject: string | null;
    language: string;
    /** Included content items, in delivery order. */
    includedContentCount: number;
    /** Included INGESTED items still awaiting review. */
    unapprovedExternalCount: number;
    /** Included items whose picture would not reach a recipient and is omitted. */
    omittedImageCount: number;
  };
  audience: {
    segmentSelected: boolean;
    /** A frozen final audience exists for this campaign. */
    finalAudiencePrepared: boolean;
    /** Set when the frozen audience no longer matches a fresh resolution. */
    stalenessMessage: string | null;
    eligibleCount: number;
    excludedCount: number;
    /** Exclusions actually stored — a truncated list is reported, never hidden. */
    exclusionsRecorded: number;
    exclusionsTruncated: boolean;
    destinationsTruncated: boolean;
    /** Eligible destinations whose consent has never been recorded. */
    consentNotConfirmedCount: number;
    /** Eligible destinations with an explicitly granted consent. */
    consentGrantedCount: number;
    /** CRM projection age, when it is known to be stale. */
    crmStaleMessage: string | null;
  };
  approval: {
    approved: boolean;
    /** Friendly reason the approval is not valid, when it is not. */
    problem: string | null;
    fourEyesSatisfied: boolean;
    fourEyesProblem: string | null;
  };
  production: {
    /** Always false in this milestone. Kept as an input so the rule is visible. */
    enabled: boolean;
  };
}

export interface ReadinessResult {
  checks: ReadinessCheck[];
  /** True only when no check is BLOCKED. Production sending is a separate gate. */
  ready: boolean;
  blockedCount: number;
  warningCount: number;
}

function check(
  key: string,
  group: ReadinessGroup,
  label: string,
  status: ReadinessStatus,
  detail: string,
): ReadinessCheck {
  return { key, group, label, status, detail };
}

const SENDABLE_STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"]);

export function evaluateSendReadiness(input: ReadinessInput): ReadinessResult {
  const { campaign, audience, approval, production } = input;
  const checks: ReadinessCheck[] = [];

  // ------------------------------- CONTENT -------------------------------
  checks.push(
    SENDABLE_STATUSES.has(campaign.status)
      ? check(
          "campaign-state",
          ReadinessGroup.CONTENT,
          "Newsletter state",
          ReadinessStatus.READY,
          "This newsletter is still in a state that can be prepared for sending.",
        )
      : check(
          "campaign-state",
          ReadinessGroup.CONTENT,
          "Newsletter state",
          ReadinessStatus.BLOCKED,
          "This newsletter has already been sent, canceled or failed, so it cannot be prepared again.",
        ),
  );

  const subject = (campaign.subject ?? "").trim();
  checks.push(
    subject !== ""
      ? check(
          "subject",
          ReadinessGroup.CONTENT,
          "Subject line",
          ReadinessStatus.READY,
          subject,
        )
      : check(
          "subject",
          ReadinessGroup.CONTENT,
          "Subject line",
          ReadinessStatus.BLOCKED,
          "Add a subject line in the newsletter details.",
        ),
  );

  checks.push(
    campaign.includedContentCount > 0
      ? check(
          "content",
          ReadinessGroup.CONTENT,
          "Articles",
          ReadinessStatus.READY,
          `${campaign.includedContentCount} article${campaign.includedContentCount === 1 ? "" : "s"} included.`,
        )
      : check(
          "content",
          ReadinessGroup.CONTENT,
          "Articles",
          ReadinessStatus.BLOCKED,
          "Add at least one approved article.",
        ),
  );

  checks.push(
    campaign.unapprovedExternalCount === 0
      ? check(
          "content-approved",
          ReadinessGroup.CONTENT,
          "Article review",
          ReadinessStatus.READY,
          "Every included article is approved.",
        )
      : check(
          "content-approved",
          ReadinessGroup.CONTENT,
          "Article review",
          ReadinessStatus.BLOCKED,
          `${campaign.unapprovedExternalCount} external article${campaign.unapprovedExternalCount === 1 ? " is" : "s are"} still waiting for review.`,
        ),
  );

  checks.push(
    campaign.omittedImageCount === 0
      ? check(
          "images",
          ReadinessGroup.CONTENT,
          "Pictures",
          ReadinessStatus.READY,
          "Every picture used can be loaded by a recipient's email client.",
        )
      : check(
          "images",
          ReadinessGroup.CONTENT,
          "Pictures",
          ReadinessStatus.WARNING,
          `${campaign.omittedImageCount} picture${campaign.omittedImageCount === 1 ? " is" : "s are"} stored where a recipient cannot reach ${campaign.omittedImageCount === 1 ? "it" : "them"}, so ${campaign.omittedImageCount === 1 ? "it" : "they"} would be left out of the email.`,
        ),
  );

  // ------------------------------- AUDIENCE ------------------------------
  checks.push(
    audience.segmentSelected
      ? check(
          "segment",
          ReadinessGroup.AUDIENCE,
          "Audience chosen",
          ReadinessStatus.READY,
          "An audience is selected for this newsletter.",
        )
      : check(
          "segment",
          ReadinessGroup.AUDIENCE,
          "Audience chosen",
          ReadinessStatus.BLOCKED,
          "Choose an audience before preparing this newsletter.",
        ),
  );

  if (!audience.finalAudiencePrepared) {
    checks.push(
      check(
        "final-audience",
        ReadinessGroup.AUDIENCE,
        "Final audience",
        ReadinessStatus.BLOCKED,
        "Prepare the final audience to freeze exactly who would receive this.",
      ),
    );
  } else if (audience.stalenessMessage) {
    checks.push(
      check(
        "final-audience",
        ReadinessGroup.AUDIENCE,
        "Final audience",
        ReadinessStatus.BLOCKED,
        audience.stalenessMessage,
      ),
    );
  } else {
    checks.push(
      check(
        "final-audience",
        ReadinessGroup.AUDIENCE,
        "Final audience",
        ReadinessStatus.READY,
        "The frozen audience still matches the people who would receive this today.",
      ),
    );
  }

  checks.push(
    audience.finalAudiencePrepared && audience.eligibleCount > 0
      ? check(
          "eligible",
          ReadinessGroup.AUDIENCE,
          "People who would receive this",
          ReadinessStatus.READY,
          `${audience.eligibleCount.toLocaleString()} email address${audience.eligibleCount === 1 ? "" : "es"}.`,
        )
      : check(
          "eligible",
          ReadinessGroup.AUDIENCE,
          "People who would receive this",
          ReadinessStatus.BLOCKED,
          audience.finalAudiencePrepared
            ? "Nobody in this audience can currently be emailed. Review the exclusions below."
            : "Prepare the final audience to see who would receive this.",
        ),
  );

  if (audience.finalAudiencePrepared) {
    const truncated = audience.exclusionsTruncated || audience.destinationsTruncated;
    checks.push(
      truncated
        ? check(
            "exclusions-recorded",
            ReadinessGroup.AUDIENCE,
            "Exclusions recorded",
            ReadinessStatus.WARNING,
            `${audience.exclusionsRecorded.toLocaleString()} of ${audience.excludedCount.toLocaleString()} exclusions were stored. The audience is larger than one snapshot can hold — narrow it before sending.`,
          )
        : check(
            "exclusions-recorded",
            ReadinessGroup.AUDIENCE,
            "Exclusions recorded",
            ReadinessStatus.READY,
            `${audience.excludedCount.toLocaleString()} excluded record${audience.excludedCount === 1 ? "" : "s"}, each with a reason.`,
          ),
    );
  }

  if (audience.crmStaleMessage) {
    checks.push(
      check(
        "crm-freshness",
        ReadinessGroup.AUDIENCE,
        "Customer data freshness",
        ReadinessStatus.WARNING,
        audience.crmStaleMessage,
      ),
    );
  }

  // ---------------------------- COMMUNICATION ----------------------------
  // Unsubscribe, suppression, invalid addresses and language are enforced by the one
  // eligibility engine that produced the counts above. This check states the posture
  // rather than re-deriving it — a second implementation is exactly what CLAUDE.md
  // forbids.
  checks.push(
    check(
      "eligibility-engine",
      ReadinessGroup.COMMUNICATION,
      "Unsubscribe, blocked and address rules",
      ReadinessStatus.READY,
      "Unsubscribed, blocked, invalid and language-mismatched addresses were removed by the same rules a send would apply.",
    ),
  );

  if (audience.finalAudiencePrepared) {
    checks.push(
      audience.consentNotConfirmedCount === 0
        ? check(
            "consent",
            ReadinessGroup.COMMUNICATION,
            "Consent",
            ReadinessStatus.READY,
            `All ${audience.consentGrantedCount.toLocaleString()} addresses are approved for communication.`,
          )
        : check(
            "consent",
            ReadinessGroup.COMMUNICATION,
            "Consent",
            ReadinessStatus.WARNING,
            `${audience.consentNotConfirmedCount.toLocaleString()} of ${audience.eligibleCount.toLocaleString()} addresses have no recorded consent. They are not refused, but nobody has confirmed them either — record a basis before a real send.`,
          ),
    );
  }

  // ------------------------------- APPROVAL ------------------------------
  checks.push(
    approval.approved
      ? check(
          "approval",
          ReadinessGroup.APPROVAL,
          "This exact newsletter and audience approved",
          ReadinessStatus.READY,
          "The approved content and audience still match what would be sent.",
        )
      : check(
          "approval",
          ReadinessGroup.APPROVAL,
          "This exact newsletter and audience approved",
          ReadinessStatus.BLOCKED,
          approval.problem ?? "This newsletter has not been approved for production yet.",
        ),
  );

  checks.push(
    approval.fourEyesSatisfied
      ? check(
          "four-eyes",
          ReadinessGroup.APPROVAL,
          "Approved by a second person",
          ReadinessStatus.READY,
          "The person who approved this is not the person who prepared it.",
        )
      : check(
          "four-eyes",
          ReadinessGroup.APPROVAL,
          "Approved by a second person",
          ReadinessStatus.BLOCKED,
          approval.fourEyesProblem ??
            "This newsletter has not been approved by a second person yet.",
        ),
  );

  // ---------------------------- INFRASTRUCTURE ---------------------------
  // Hard-wired BLOCKED. `production.enabled` is read only so that a future change
  // has to touch this line deliberately: there is no delivery engine behind it, so a
  // flag flipped anywhere else must not be able to turn this check green.
  void production.enabled;
  checks.push(
    check(
      "production",
      ReadinessGroup.INFRASTRUCTURE,
      "Production sending",
      ReadinessStatus.BLOCKED,
      "Production customer sending has not been enabled.",
    ),
  );

  const blockedCount = checks.filter((c) => c.status === ReadinessStatus.BLOCKED).length;
  const warningCount = checks.filter((c) => c.status === ReadinessStatus.WARNING).length;

  return { checks, ready: blockedCount === 0, blockedCount, warningCount };
}

/** Checks excluding the deliberate production block — "everything else is ready". */
export function preparationComplete(result: ReadinessResult): boolean {
  return result.checks
    .filter((c) => c.group !== ReadinessGroup.INFRASTRUCTURE)
    .every((c) => c.status !== ReadinessStatus.BLOCKED);
}
