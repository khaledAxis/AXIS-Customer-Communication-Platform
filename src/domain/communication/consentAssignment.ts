import { ConsentSource, ConsentStatus } from "../types";

/**
 * Validation for staff-recorded communication consent (ADR-0021).
 *
 * Consent is LOCAL-owned, email-centric data: Monday has no consent column, so every
 * value here was put there by a person. Nothing is ever inferred — not from a name,
 * not from a language, not from the mere existence of a CRM record.
 *
 * The asymmetry in this module is deliberate:
 *
 *   - GRANTED requires a documented basis, an effective date and an explicit
 *     confirmation. Approving someone for email is the only change here that can
 *     lead to mail being sent, so it is the only one that has to be justified.
 *   - DENIED and UNKNOWN require confirmation but no basis. Refusing to send never
 *     needs paperwork, and demanding some would discourage the safe choice.
 *
 * What this module deliberately cannot express: there is no language field, no
 * emailStatus field, and no unsubscribe/suppression field. Those cannot be changed
 * through the consent path because there is nothing to change them with.
 *
 * The labels below are ADMINISTRATIVE METADATA recording what a person asserted.
 * They are not, and must never be presented as, a legal determination made by this
 * software: choosing an adequate basis is the operator's responsibility.
 *
 * Pure: no I/O, no framework imports.
 */

/** The only values staff may assign. Adding one is a business decision, not a patch. */
export const ASSIGNABLE_CONSENT: readonly ConsentStatus[] = [
  ConsentStatus.UNKNOWN,
  ConsentStatus.GRANTED,
  ConsentStatus.DENIED,
];

/** The documented bases a person may select when approving an address. */
export const CONSENT_SOURCES: readonly ConsentSource[] = [
  ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
  ConsentSource.EXPLICIT_CUSTOMER_PERMISSION,
  ConsentSource.IMPORTED_DOCUMENTED_PERMISSION,
  ConsentSource.OTHER_DOCUMENTED_BASIS,
];

/**
 * "Other" is a catch-all, so on its own it documents nothing. A note is required
 * with it — that is the whole point of choosing it.
 */
export const CONSENT_SOURCE_REQUIRES_NOTE: readonly ConsentSource[] = [
  ConsentSource.OTHER_DOCUMENTED_BASIS,
];

/** Bound on one bulk operation, so a runaway selection cannot rewrite everything. */
export const MAX_BULK_ADDRESSES = 2_000;

/** Upper bound on the free-text note, so an unbounded blob cannot be stored. */
export const MAX_NOTE_LENGTH = 500;

export type ConsentAssignmentRejection =
  | "UNSUPPORTED_STATUS"
  | "NO_ADDRESSES_SELECTED"
  | "TOO_MANY_ADDRESSES"
  | "MALFORMED_SELECTION"
  | "NOT_CONFIRMED"
  | "SOURCE_REQUIRED"
  | "UNSUPPORTED_SOURCE"
  | "NOTE_REQUIRED"
  | "NOTE_TOO_LONG"
  | "EFFECTIVE_DATE_REQUIRED"
  | "EFFECTIVE_DATE_INVALID"
  | "EFFECTIVE_DATE_IN_FUTURE";

export const CONSENT_ASSIGNMENT_MESSAGE: Record<ConsentAssignmentRejection, string> = {
  UNSUPPORTED_STATUS: "Choose one of the available consent options.",
  NO_ADDRESSES_SELECTED: "Select at least one email address first.",
  TOO_MANY_ADDRESSES: `You can change at most ${MAX_BULK_ADDRESSES} addresses at once.`,
  MALFORMED_SELECTION: "That selection could not be read. Please try again.",
  NOT_CONFIRMED: "Tick the confirmation box before saving this change.",
  SOURCE_REQUIRED:
    "Choose the basis you are relying on before approving an address for communication.",
  UNSUPPORTED_SOURCE: "Choose one of the listed bases.",
  NOTE_REQUIRED: "Describe the documented basis you are relying on.",
  NOTE_TOO_LONG: `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
  EFFECTIVE_DATE_REQUIRED: "Enter the date this permission applies from.",
  EFFECTIVE_DATE_INVALID: "That date could not be read. Use the date picker.",
  EFFECTIVE_DATE_IN_FUTURE: "The effective date cannot be in the future.",
};

export class ConsentAssignmentError extends Error {
  readonly reason: ConsentAssignmentRejection;

  constructor(reason: ConsentAssignmentRejection) {
    super(CONSENT_ASSIGNMENT_MESSAGE[reason]);
    this.name = "ConsentAssignmentError";
    this.reason = reason;
  }
}

export function isAssignableConsent(value: unknown): value is ConsentStatus {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_CONSENT as readonly string[]).includes(value)
  );
}

export function isConsentSource(value: unknown): value is ConsentSource {
  return (
    typeof value === "string" && (CONSENT_SOURCES as readonly string[]).includes(value)
  );
}

export interface ConsentAssignment {
  status: ConsentStatus;
  /** Deduplicated, in submission order. */
  addressIds: string[];
  /** Present only for GRANTED — the other statuses have no basis to record. */
  source: ConsentSource | null;
  note: string | null;
  effectiveAt: Date | null;
}

export interface ConsentAssignmentInput {
  status: unknown;
  addressIds: unknown;
  source?: unknown;
  note?: unknown;
  /** ISO date (yyyy-mm-dd) or full timestamp, as submitted by the form. */
  effectiveAt?: unknown;
  /** Explicit human confirmation. A truthy checkbox value; never defaulted. */
  confirmed?: unknown;
  /** Clock injection so the "not in the future" rule is testable. */
  now?: Date;
}

function parseAddressIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new ConsentAssignmentError("MALFORMED_SELECTION");

  const seen = new Set<string>();
  const addressIds: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      throw new ConsentAssignmentError("MALFORMED_SELECTION");
    }
    const id = value.trim();
    if (id === "") throw new ConsentAssignmentError("MALFORMED_SELECTION");
    if (seen.has(id)) continue;
    seen.add(id);
    addressIds.push(id);
  }

  if (addressIds.length === 0) {
    throw new ConsentAssignmentError("NO_ADDRESSES_SELECTED");
  }
  if (addressIds.length > MAX_BULK_ADDRESSES) {
    throw new ConsentAssignmentError("TOO_MANY_ADDRESSES");
  }
  return addressIds;
}

/** A checkbox arrives as "on"/"true"/"1"; anything else is treated as not ticked. */
function isConfirmed(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1" || value === "yes";
}

function parseEffectiveAt(raw: unknown, now: Date): Date {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new ConsentAssignmentError("EFFECTIVE_DATE_INVALID");
    }
    if (raw.getTime() > now.getTime()) {
      throw new ConsentAssignmentError("EFFECTIVE_DATE_IN_FUTURE");
    }
    return raw;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConsentAssignmentError("EFFECTIVE_DATE_REQUIRED");
  }

  const text = raw.trim();
  // A bare yyyy-mm-dd is read as UTC midnight so the stored instant does not shift
  // with the server's timezone — the operator picked a day, not a moment.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    throw new ConsentAssignmentError("EFFECTIVE_DATE_INVALID");
  }
  if (parsed.getTime() > now.getTime()) {
    throw new ConsentAssignmentError("EFFECTIVE_DATE_IN_FUTURE");
  }
  return parsed;
}

function parseNote(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new ConsentAssignmentError("MALFORMED_SELECTION");
  const note = raw.trim();
  if (note === "") return null;
  if (note.length > MAX_NOTE_LENGTH) {
    throw new ConsentAssignmentError("NOTE_TOO_LONG");
  }
  return note;
}

/**
 * Parses an untrusted consent request.
 *
 * Every rejection is a refusal, never a repair: a missing basis is not filled in with
 * a default, and an unrecognised one is not mapped to "Other". Silently substituting
 * a value here would put words in a person's mouth about why someone may be emailed.
 */
export function parseConsentAssignment(input: ConsentAssignmentInput): ConsentAssignment {
  if (!isAssignableConsent(input.status)) {
    throw new ConsentAssignmentError("UNSUPPORTED_STATUS");
  }

  const addressIds = parseAddressIds(input.addressIds);

  // Every consent change is confirmed, including the safe ones — the confirmation is
  // what makes it a decision rather than a stray click on a table row.
  if (!isConfirmed(input.confirmed)) {
    throw new ConsentAssignmentError("NOT_CONFIRMED");
  }

  const note = parseNote(input.note);

  if (input.status !== ConsentStatus.GRANTED) {
    // Refusing or clearing consent records no basis: there is nothing to justify.
    return { status: input.status, addressIds, source: null, note, effectiveAt: null };
  }

  if (input.source == null || input.source === "") {
    throw new ConsentAssignmentError("SOURCE_REQUIRED");
  }
  if (!isConsentSource(input.source)) {
    throw new ConsentAssignmentError("UNSUPPORTED_SOURCE");
  }
  if (
    (CONSENT_SOURCE_REQUIRES_NOTE as readonly string[]).includes(input.source) &&
    note === null
  ) {
    throw new ConsentAssignmentError("NOTE_REQUIRED");
  }

  const effectiveAt = parseEffectiveAt(input.effectiveAt, input.now ?? new Date());

  return { status: input.status, addressIds, source: input.source, note, effectiveAt };
}

export interface ConsentCounts {
  UNKNOWN: number;
  GRANTED: number;
  DENIED: number;
}

/**
 * What the counts would become if `selected` addresses were set to `status`.
 *
 * Informational only — used to show "Approved 0 → 47" before the user commits.
 * `selected` is the current status of each address being changed.
 */
export function projectConsentCounts(
  current: ConsentCounts,
  selected: ConsentStatus[],
  target: ConsentStatus,
): ConsentCounts {
  const next: ConsentCounts = { ...current };
  for (const from of selected) {
    if (from === target) continue;
    next[from] = Math.max(0, next[from] - 1);
    next[target] += 1;
  }
  return next;
}
