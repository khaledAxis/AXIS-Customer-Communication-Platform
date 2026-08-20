import { createHash } from "node:crypto";

import type { ConsentStatus, EmailStatus, ExclusionReason, Language } from "../types";

/**
 * Identity of ONE frozen final audience (ADR-0022).
 *
 * A draft audience preview answers "who would receive this today"; it is deliberately
 * re-derivable and is replaced whenever it is recomputed. A FINAL audience is the
 * opposite: it is frozen at a moment, never edited, and an approval is bound to it.
 *
 * Staleness is therefore not a stored flag that something has to remember to set. It
 * is a comparison: re-resolve the audience now, hash it the same way, and if the two
 * hashes differ the frozen one no longer describes reality. Any change that can move
 * a person in or out of the audience — a CRM resync, a language or consent edit, an
 * unsubscribe, a suppression, an edited segment, a different campaign language —
 * changes one of the inputs below and therefore changes the hash. Nothing has to
 * subscribe to those events for the check to be correct.
 *
 * `node:crypto` is stdlib and the hash is a pure function of its input, so `domain/`
 * stays free of I/O and framework imports per CLAUDE.md.
 */

/** One frozen deliverable destination, with the CRM records that produced it. */
export interface FinalDestination {
  normalizedEmail: string;
  /** The exact address chosen for delivery, before normalization. */
  intendedEmail: string;
  language: Language;
  consentStatus: ConsentStatus;
  emailStatus: EmailStatus;
  sources: FinalDestinationSource[];
}

export interface FinalDestinationSource {
  sourceBoardId: string;
  sourceItemId: string;
  sourceEntityType: string;
  emailSourceType: string;
  sourceEmailRaw: string;
  /** Friendly CRM name shown in the audience inspector, never a database id. */
  label: string;
  companyName: string | null;
}

/** One frozen exclusion, with the CRM record it came from. */
export interface FinalExclusion {
  sourceBoardId: string;
  sourceItemId: string;
  sourceEntityType: string;
  emailSourceType: string;
  sourceEmailRaw: string | null;
  normalizedEmail: string | null;
  reason: ExclusionReason;
  label: string;
}

/** Everything that determines who this audience is. */
export interface FinalAudienceSubjectMatter {
  campaignId: string;
  segmentId: string | null;
  /** The segment rules as they stood, serialized deterministically. */
  segmentCriteria: unknown;
  /** The campaign's language at freeze time. */
  campaignLanguage: Language;
  /** The language addresses had to match, or null for a non-localized campaign. */
  requireLanguage: Language | null;
  requireExplicitConsent: boolean;
  destinations: FinalDestination[];
  exclusions: FinalExclusion[];
}

/**
 * Stable JSON: object keys are emitted in sorted order at every depth, so two
 * structurally identical definitions hash identically regardless of how they were
 * built or round-tripped through the database.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

function destinationLine(destination: FinalDestination): string {
  // Sources are sorted so the same set of CRM records always serializes the same way,
  // whatever order the database returned them in.
  const sources = destination.sources
    .map(
      (s) =>
        `${s.sourceBoardId}/${s.sourceItemId}/${s.sourceEntityType}/${s.emailSourceType}/${s.sourceEmailRaw.trim().toLowerCase()}`,
    )
    .sort()
    .join(";");
  return [
    destination.normalizedEmail,
    destination.language,
    destination.consentStatus,
    destination.emailStatus,
    sources,
  ].join("|");
}

function exclusionLine(exclusion: FinalExclusion): string {
  return [
    exclusion.sourceBoardId,
    exclusion.sourceItemId,
    exclusion.sourceEntityType,
    exclusion.emailSourceType,
    (exclusion.normalizedEmail ?? exclusion.sourceEmailRaw ?? "").trim().toLowerCase(),
    exclusion.reason,
  ].join("|");
}

/**
 * Deterministic canonical serialization of a resolved audience.
 *
 * Field order is written out explicitly rather than relying on object key order, and
 * nothing time-based or random is included, so the same audience always produces the
 * same bytes on any machine and any run.
 *
 * Note what is deliberately absent: friendly labels. A company renamed in Monday must
 * not, on its own, invalidate an approved audience — the same people still receive
 * the same email. Identity, address and eligibility state are what matter.
 */
export function canonicalAudiencePayload(matter: FinalAudienceSubjectMatter): string {
  const destinations = matter.destinations.map(destinationLine).sort();
  const exclusions = matter.exclusions.map(exclusionLine).sort();

  const ordered: [string, string][] = [
    ["campaignId", matter.campaignId],
    ["segmentId", matter.segmentId ?? ""],
    ["segmentCriteria", stableJson(matter.segmentCriteria)],
    ["campaignLanguage", matter.campaignLanguage],
    ["requireLanguage", matter.requireLanguage ?? ""],
    ["requireExplicitConsent", matter.requireExplicitConsent ? "1" : "0"],
    ["destinationCount", String(destinations.length)],
    ["destinations", destinations.join("\n")],
    ["exclusionCount", String(exclusions.length)],
    ["exclusions", exclusions.join("\n")],
  ];

  // Length-prefixed so no field value can imitate a field boundary.
  return ordered.map(([key, value]) => `${key}:${value.length}:${value}`).join("\n");
}

export function computeAudienceHash(matter: FinalAudienceSubjectMatter): string {
  return createHash("sha256")
    .update(canonicalAudiencePayload(matter), "utf8")
    .digest("hex");
}

export type StalenessVerdict =
  | { stale: false }
  | { stale: true; reason: AudienceStalenessReason };

export type AudienceStalenessReason =
  | "AUDIENCE_CHANGED"
  | "SEGMENT_CHANGED"
  | "SEGMENT_REMOVED"
  | "CAMPAIGN_LANGUAGE_CHANGED";

export const AUDIENCE_STALENESS_MESSAGE: Record<AudienceStalenessReason, string> = {
  AUDIENCE_CHANGED: "Audience changed after snapshot. Prepare the final audience again.",
  SEGMENT_CHANGED:
    "The audience rules changed after snapshot. Prepare the final audience again.",
  SEGMENT_REMOVED:
    "The audience chosen for this newsletter changed. Prepare the final audience again.",
  CAMPAIGN_LANGUAGE_CHANGED:
    "The newsletter language changed after snapshot. Prepare the final audience again.",
};

export interface AudienceFingerprint {
  audienceHash: string;
  segmentId: string | null;
  /** The segment rules, stably serialized — see `stableJson`. */
  segmentCriteria: string;
  campaignLanguage: Language;
}

export interface StalenessInput {
  frozen: AudienceFingerprint;
  current: AudienceFingerprint;
}

/**
 * Compares a frozen audience with a freshly resolved one.
 *
 * The specific reasons are reported before the generic one so the message names what
 * a person actually changed. All of them are the same verdict: not production-ready.
 */
export function evaluateStaleness(input: StalenessInput): StalenessVerdict {
  const { frozen, current } = input;

  if (frozen.segmentId !== current.segmentId) {
    return { stale: true, reason: "SEGMENT_REMOVED" };
  }
  if (frozen.segmentCriteria !== current.segmentCriteria) {
    return { stale: true, reason: "SEGMENT_CHANGED" };
  }
  if (frozen.campaignLanguage !== current.campaignLanguage) {
    return { stale: true, reason: "CAMPAIGN_LANGUAGE_CHANGED" };
  }
  if (frozen.audienceHash !== current.audienceHash) {
    return { stale: true, reason: "AUDIENCE_CHANGED" };
  }
  return { stale: false };
}
