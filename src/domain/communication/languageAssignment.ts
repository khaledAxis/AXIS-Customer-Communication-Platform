import { Language } from "../types";

/**
 * Validation for staff-assigned communication language (ADR-0020).
 *
 * Language is LOCAL-owned data: Monday has no language column, so every value here
 * was put there by a person. Nothing is ever inferred — not from a name, not from a
 * domain, not from CRM presence.
 *
 * Note what this module deliberately cannot express: there is no consent field, no
 * emailStatus field, and no unsubscribe/suppression field. Those cannot be changed
 * through the language assignment path because there is nothing to change them with.
 *
 * Pure: no I/O, no framework imports.
 */

/** The only values staff may assign. Adding one is a business decision, not a patch. */
export const ASSIGNABLE_LANGUAGES: readonly Language[] = [
  Language.HE,
  Language.AR,
  Language.UNKNOWN,
];

/** Bound on one bulk operation, so a runaway selection cannot rewrite everything. */
export const MAX_BULK_ADDRESSES = 2_000;

export type LanguageAssignmentRejection =
  | "UNSUPPORTED_LANGUAGE"
  | "NO_ADDRESSES_SELECTED"
  | "TOO_MANY_ADDRESSES"
  | "MALFORMED_SELECTION";

export class LanguageAssignmentError extends Error {
  readonly reason: LanguageAssignmentRejection;

  constructor(reason: LanguageAssignmentRejection) {
    super(LANGUAGE_ASSIGNMENT_MESSAGE[reason]);
    this.name = "LanguageAssignmentError";
    this.reason = reason;
  }
}

export const LANGUAGE_ASSIGNMENT_MESSAGE: Record<LanguageAssignmentRejection, string> = {
  UNSUPPORTED_LANGUAGE: "Choose Hebrew, Arabic, or Not set.",
  NO_ADDRESSES_SELECTED: "Select at least one email address first.",
  TOO_MANY_ADDRESSES: `You can change at most ${MAX_BULK_ADDRESSES} addresses at once.`,
  MALFORMED_SELECTION: "That selection could not be read. Please try again.",
};

export function isAssignableLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_LANGUAGES as readonly string[]).includes(value)
  );
}

export interface LanguageAssignment {
  language: Language;
  /** Deduplicated, in submission order. */
  addressIds: string[];
}

/**
 * Parses an untrusted assignment request.
 *
 * Duplicates are collapsed rather than rejected — selecting the same row twice is a
 * UI accident, not an attack, and applying the same value twice is harmless. Anything
 * that is not a plain non-empty string id IS rejected.
 */
export function parseLanguageAssignment(input: {
  language: unknown;
  addressIds: unknown;
}): LanguageAssignment {
  if (!isAssignableLanguage(input.language)) {
    throw new LanguageAssignmentError("UNSUPPORTED_LANGUAGE");
  }

  if (!Array.isArray(input.addressIds)) {
    throw new LanguageAssignmentError("MALFORMED_SELECTION");
  }

  const seen = new Set<string>();
  const addressIds: string[] = [];
  for (const raw of input.addressIds) {
    if (typeof raw !== "string") {
      throw new LanguageAssignmentError("MALFORMED_SELECTION");
    }
    const id = raw.trim();
    if (id === "") throw new LanguageAssignmentError("MALFORMED_SELECTION");
    if (seen.has(id)) continue;
    seen.add(id);
    addressIds.push(id);
  }

  if (addressIds.length === 0) {
    throw new LanguageAssignmentError("NO_ADDRESSES_SELECTED");
  }
  if (addressIds.length > MAX_BULK_ADDRESSES) {
    throw new LanguageAssignmentError("TOO_MANY_ADDRESSES");
  }

  return { language: input.language, addressIds };
}

export interface LanguageCounts {
  UNKNOWN: number;
  HE: number;
  AR: number;
}

/**
 * What the counts would become if `selected` addresses were set to `language`.
 *
 * Informational only — used to show "Hebrew: 0 → 120" before the user commits.
 * `selected` is the current language of each address being changed.
 */
export function projectLanguageCounts(
  current: LanguageCounts,
  selected: Language[],
  target: Language,
): LanguageCounts {
  const next: LanguageCounts = { ...current };
  for (const from of selected) {
    if (from === target) continue;
    next[from] = Math.max(0, next[from] - 1);
    next[target] += 1;
  }
  return next;
}
