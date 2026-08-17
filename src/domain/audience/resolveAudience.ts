import {
  CrmBoardKind,
  EmailSourceType,
  ExclusionReason,
  Language,
} from "../types";
import {
  AddressProfile,
  evaluateEligibility,
} from "../eligibility/eligibility";

/**
 * Pure audience resolution + deduplication (ADR-0009 §D/§E/§F).
 *
 * Pipeline: candidates -> eligibility -> normalize -> dedupe by normalized email.
 * Guarantees ONE deliverable destination per normalized email while preserving
 * every contributing CRM record. Pre-recipient exclusions are returned as
 * exclusion records + summary counts (NEVER as fake recipient rows). Duplicate
 * sources that collapse into an existing destination are retained as sources and
 * counted in `duplicateSourcesCollapsed` — they are not exclusions.
 *
 * This function does NOT send anything and is unaware of TEST/PRODUCTION mode:
 * resolving N candidates yields drafts, never emails.
 */

export interface AudienceCandidate {
  sourceBoardId: string;
  sourceItemId: string;
  sourceEntityType: CrmBoardKind;
  emailSourceType: EmailSourceType;
  rawEmail: string | null | undefined;
  address?: AddressProfile;
  sourceArchived?: boolean;
  companyInactive?: boolean;
  /** Optional local navigation ids (audit convenience). */
  companyId?: string;
  contactId?: string;
}

export interface RecipientSourceDraft {
  sourceBoardId: string;
  sourceItemId: string;
  sourceEntityType: CrmBoardKind;
  emailSourceType: EmailSourceType;
  sourceEmailRaw: string;
  companyId?: string;
  contactId?: string;
}

export interface RecipientDraft {
  normalizedEmail: string;
  intendedEmail: string;
  sources: RecipientSourceDraft[];
}

export interface ExclusionRecord {
  sourceBoardId: string;
  sourceItemId: string;
  sourceEntityType: CrmBoardKind;
  emailSourceType: EmailSourceType;
  sourceEmailRaw: string | null;
  normalizedEmail?: string;
  reason: ExclusionReason;
}

export interface AudienceSnapshot {
  matchedRecords: number;
  withCandidateEmail: number;
  eligible: number;
  uniqueDestinations: number;
  excluded: number;
  duplicateSourcesCollapsed: number;
  breakdown: Record<ExclusionReason, number>;
}

export interface AudienceResult {
  recipients: RecipientDraft[];
  exclusions: ExclusionRecord[];
  snapshot: AudienceSnapshot;
}

export interface ResolveOptions {
  requireLanguage?: Language;
}

function emptyBreakdown(): Record<ExclusionReason, number> {
  return {
    NO_EMAIL: 0,
    INVALID_EMAIL: 0,
    UNSUBSCRIBED: 0,
    SUPPRESSED: 0,
    CONSENT_DENIED: 0,
    COMPANY_INACTIVE: 0,
    ARCHIVED: 0,
    LANGUAGE_UNKNOWN: 0,
  };
}

function sourceIdentity(c: AudienceCandidate): string {
  return `${c.sourceBoardId}|${c.sourceItemId}|${c.emailSourceType}`;
}

export function resolveAudience(
  candidates: AudienceCandidate[],
  opts: ResolveOptions = {},
): AudienceResult {
  const breakdown = emptyBreakdown();
  const exclusions: ExclusionRecord[] = [];

  // normalizedEmail -> draft + set of attached source identities
  const byEmail = new Map<
    string,
    { draft: RecipientDraft; ids: Set<string> }
  >();

  let withCandidateEmail = 0;
  let eligible = 0;
  let duplicateSourcesCollapsed = 0;

  for (const c of candidates) {
    const outcome = evaluateEligibility({
      rawEmail: c.rawEmail,
      address: c.address,
      sourceArchived: c.sourceArchived,
      companyInactive: c.companyInactive,
      requireLanguage: opts.requireLanguage,
    });

    // "has a candidate email" = not the NO_EMAIL case
    const hasEmail =
      !(outcome.eligible === false && outcome.reason === ExclusionReason.NO_EMAIL);
    if (hasEmail) withCandidateEmail++;

    if (!outcome.eligible) {
      breakdown[outcome.reason]++;
      exclusions.push({
        sourceBoardId: c.sourceBoardId,
        sourceItemId: c.sourceItemId,
        sourceEntityType: c.sourceEntityType,
        emailSourceType: c.emailSourceType,
        sourceEmailRaw: c.rawEmail == null ? null : c.rawEmail.trim(),
        reason: outcome.reason,
      });
      continue;
    }

    const key = outcome.normalizedEmail;
    const identity = sourceIdentity(c);
    const source: RecipientSourceDraft = {
      sourceBoardId: c.sourceBoardId,
      sourceItemId: c.sourceItemId,
      sourceEntityType: c.sourceEntityType,
      emailSourceType: c.emailSourceType,
      sourceEmailRaw: (c.rawEmail ?? "").trim(),
      companyId: c.companyId,
      contactId: c.contactId,
    };

    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, {
        draft: { normalizedEmail: key, intendedEmail: source.sourceEmailRaw, sources: [source] },
        ids: new Set([identity]),
      });
      eligible++;
    } else if (!existing.ids.has(identity)) {
      // same destination, different CRM source → retain as a source (not an exclusion)
      existing.ids.add(identity);
      existing.draft.sources.push(source);
      eligible++;
      duplicateSourcesCollapsed++;
    }
    // else: exact same source identity seen twice → idempotent no-op (cannot attach twice)
  }

  const recipients = [...byEmail.values()].map((v) => v.draft);

  return {
    recipients,
    exclusions,
    snapshot: {
      matchedRecords: candidates.length,
      withCandidateEmail,
      eligible,
      uniqueDestinations: recipients.length,
      excluded: exclusions.length,
      duplicateSourcesCollapsed,
      breakdown,
    },
  };
}
