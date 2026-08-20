import {
  CompanyCrmStatus,
  ConsentStatus,
  EmailStatus,
  Language,
} from "../types";

/**
 * The segmentation vocabulary: every field AXIS staff can filter on, and the
 * operators each one accepts.
 *
 * Pure data + pure functions. This module never touches Prisma, and it never
 * mentions a Monday column id — the UI renders friendly labels from here, so a
 * board column can be renamed without changing what staff see (ADR-0018).
 */

export const FieldScope = {
  /** Filters companies. */
  COMPANY: "COMPANY",
  /** Filters contacts. */
  CONTACT: "CONTACT",
  /** Filters companies by the products they own. */
  PRODUCT: "PRODUCT",
  /** Filters the resolved email address, not the CRM record. */
  COMMUNICATION: "COMMUNICATION",
} as const;
export type FieldScope = (typeof FieldScope)[keyof typeof FieldScope];

export const Operator = {
  // text
  EQUALS: "EQUALS",
  CONTAINS: "CONTAINS",
  STARTS_WITH: "STARTS_WITH",
  IS_EMPTY: "IS_EMPTY",
  IS_NOT_EMPTY: "IS_NOT_EMPTY",
  // enum / status
  IS: "IS",
  IS_NOT: "IS_NOT",
  IS_ONE_OF: "IS_ONE_OF",
  // dates
  BEFORE: "BEFORE",
  AFTER: "AFTER",
  WITHIN_NEXT_DAYS: "WITHIN_NEXT_DAYS",
  EXPIRED: "EXPIRED",
  NOT_EXPIRED: "NOT_EXPIRED",
  // yes / no
  IS_YES: "IS_YES",
  IS_NO: "IS_NO",
  // product ownership
  OWNS: "OWNS",
  DOES_NOT_OWN: "DOES_NOT_OWN",
} as const;
export type Operator = (typeof Operator)[keyof typeof Operator];

/** What the value input looks like, and how the value is validated. */
export const ValueKind = {
  /** Free text. */
  TEXT: "TEXT",
  /** A fixed list of choices defined in code. */
  ENUM: "ENUM",
  /** Choices loaded from the CRM (industries, classifications, product types). */
  LOOKUP: "LOOKUP",
  /** A calendar date, or a number of days for WITHIN_NEXT_DAYS. */
  DATE: "DATE",
  /** No value at all — the operator carries the whole meaning. */
  NONE: "NONE",
} as const;
export type ValueKind = (typeof ValueKind)[keyof typeof ValueKind];

/** Lookup lists the UI has to load from the database before rendering choices. */
export const LookupSource = {
  INDUSTRY: "INDUSTRY",
  CLASSIFICATION: "CLASSIFICATION",
  PRODUCT_TYPE: "PRODUCT_TYPE",
} as const;
export type LookupSource = (typeof LookupSource)[keyof typeof LookupSource];

export interface FieldDefinition {
  key: string;
  scope: FieldScope;
  /** Friendly label shown in the condition builder. */
  label: string;
  /** Optional one-line explanation shown under the condition. */
  hint?: string;
  valueKind: ValueKind;
  operators: readonly Operator[];
  /** For ENUM fields: the allowed values, with friendly labels. */
  choices?: readonly { value: string; label: string }[];
  /** For LOOKUP fields: which list to load. */
  lookup?: LookupSource;
  /**
   * Fields that are supported but sparsely populated in the CRM today.
   * Surfaced honestly in the UI rather than hidden (CLAUDE.md).
   */
  coverageNote?: string;
}

const TEXT_OPS = [
  Operator.EQUALS,
  Operator.CONTAINS,
  Operator.STARTS_WITH,
  Operator.IS_EMPTY,
  Operator.IS_NOT_EMPTY,
] as const;

const ENUM_OPS = [Operator.IS, Operator.IS_NOT, Operator.IS_ONE_OF] as const;

const LOOKUP_OPS = [
  Operator.IS,
  Operator.IS_NOT,
  Operator.IS_ONE_OF,
  Operator.IS_EMPTY,
  Operator.IS_NOT_EMPTY,
] as const;

const DATE_OPS = [
  Operator.BEFORE,
  Operator.AFTER,
  Operator.WITHIN_NEXT_DAYS,
  Operator.EXPIRED,
  Operator.NOT_EXPIRED,
] as const;

const YES_NO_OPS = [Operator.IS_YES, Operator.IS_NO] as const;

const STATUS_CHOICES = [
  { value: CompanyCrmStatus.ACTIVE, label: "Active" },
  { value: CompanyCrmStatus.POTENTIAL, label: "Potential" },
  { value: CompanyCrmStatus.INACTIVE, label: "Inactive" },
  { value: CompanyCrmStatus.UNKNOWN, label: "Not set in Monday" },
] as const;

const LANGUAGE_CHOICES = [
  { value: Language.HE, label: "Hebrew" },
  { value: Language.AR, label: "Arabic" },
  { value: Language.UNKNOWN, label: "Not set" },
] as const;

const CONSENT_CHOICES = [
  { value: ConsentStatus.GRANTED, label: "Approved for communication" },
  { value: ConsentStatus.UNKNOWN, label: "Not confirmed" },
  { value: ConsentStatus.DENIED, label: "Do not send" },
] as const;

const EMAIL_STATUS_CHOICES = [
  { value: EmailStatus.VALID, label: "Checked and valid" },
  { value: EmailStatus.UNKNOWN, label: "Not checked" },
  { value: EmailStatus.INVALID, label: "Known invalid" },
] as const;

/**
 * The catalogue, ordered the way it is presented in the UI: classification and
 * product ownership first, because those are the dimensions the real CRM data
 * can actually segment on today.
 */
export const SEGMENT_FIELDS: readonly FieldDefinition[] = [
  // ---- Company -----------------------------------------------------------
  {
    key: "company.classification",
    scope: FieldScope.COMPANY,
    label: "Customer classification",
    hint: "How the customer is classified in Monday.",
    valueKind: ValueKind.LOOKUP,
    lookup: LookupSource.CLASSIFICATION,
    operators: LOOKUP_OPS,
  },
  {
    key: "company.status",
    scope: FieldScope.COMPANY,
    label: "Customer status",
    valueKind: ValueKind.ENUM,
    choices: STATUS_CHOICES,
    operators: ENUM_OPS,
    coverageNote: "Most companies have no status set in Monday.",
  },
  {
    key: "company.category",
    scope: FieldScope.COMPANY,
    label: "Category",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
  },
  {
    key: "company.industry",
    scope: FieldScope.COMPANY,
    label: "Industry",
    valueKind: ValueKind.LOOKUP,
    lookup: LookupSource.INDUSTRY,
    operators: LOOKUP_OPS,
    coverageNote:
      "Filled in for only a small share of companies — use classification for broad segments.",
  },
  {
    key: "company.name",
    scope: FieldScope.COMPANY,
    label: "Company name",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
  },
  {
    key: "company.email",
    scope: FieldScope.COMPANY,
    label: "Company newsletter email",
    hint: "The company's own campaign address. The accounting address is never used.",
    valueKind: ValueKind.NONE,
    operators: [Operator.IS_EMPTY, Operator.IS_NOT_EMPTY],
  },
  {
    key: "company.archived",
    scope: FieldScope.COMPANY,
    label: "Archived in Monday",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },

  // ---- Products ----------------------------------------------------------
  {
    key: "product.any",
    scope: FieldScope.PRODUCT,
    label: "Owns any product",
    hint: "Whether anything from the catalogue is recorded against the customer.",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },
  {
    key: "product.name",
    scope: FieldScope.PRODUCT,
    label: "Owns product (by name)",
    hint: "For example Trimble matches every Trimble product the customer owns.",
    valueKind: ValueKind.TEXT,
    operators: [
      Operator.OWNS,
      Operator.DOES_NOT_OWN,
      Operator.EQUALS,
      Operator.CONTAINS,
      Operator.STARTS_WITH,
    ],
  },
  {
    key: "product.type",
    scope: FieldScope.PRODUCT,
    label: "Owns product of type",
    hint: "The product type from the Monday catalogue.",
    valueKind: ValueKind.LOOKUP,
    lookup: LookupSource.PRODUCT_TYPE,
    operators: [Operator.IS, Operator.IS_NOT, Operator.IS_ONE_OF],
  },
  {
    key: "product.sku",
    scope: FieldScope.PRODUCT,
    label: "Owns product with catalogue number",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
    coverageNote: "Almost no products have a catalogue number filled in yet.",
  },
  {
    key: "customerProduct.status",
    scope: FieldScope.PRODUCT,
    label: "Owned product status",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
    coverageNote: "Not filled in for any owned product yet.",
  },
  {
    key: "customerProduct.subscriptionUntil",
    scope: FieldScope.PRODUCT,
    label: "Subscription expiry",
    hint: "Use this for renewal campaigns.",
    valueKind: ValueKind.DATE,
    operators: DATE_OPS,
  },
  {
    key: "customerProduct.softwareWarrantyUntil",
    scope: FieldScope.PRODUCT,
    label: "Software warranty expiry",
    valueKind: ValueKind.DATE,
    operators: DATE_OPS,
  },
  {
    key: "customerProduct.hardwareWarrantyUntil",
    scope: FieldScope.PRODUCT,
    label: "Hardware warranty expiry",
    valueKind: ValueKind.DATE,
    operators: DATE_OPS,
    coverageNote: "Recorded for only a handful of owned products.",
  },
  {
    key: "customerProduct.purchaseDate",
    scope: FieldScope.PRODUCT,
    label: "Purchase date",
    valueKind: ValueKind.DATE,
    operators: [Operator.BEFORE, Operator.AFTER],
  },

  // ---- Contacts ----------------------------------------------------------
  {
    key: "contact.jobTitle",
    scope: FieldScope.CONTACT,
    label: "Job title",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
  },
  {
    key: "contact.name",
    scope: FieldScope.CONTACT,
    label: "Contact name",
    valueKind: ValueKind.TEXT,
    operators: TEXT_OPS,
  },
  {
    key: "contact.email",
    scope: FieldScope.CONTACT,
    label: "Contact email",
    valueKind: ValueKind.NONE,
    operators: [Operator.IS_EMPTY, Operator.IS_NOT_EMPTY],
  },
  {
    key: "contact.hasCompany",
    scope: FieldScope.CONTACT,
    label: "Linked to a company",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },
  {
    key: "contact.companyName",
    scope: FieldScope.CONTACT,
    label: "Linked company name",
    valueKind: ValueKind.TEXT,
    operators: [Operator.EQUALS, Operator.CONTAINS, Operator.STARTS_WITH],
  },
  {
    key: "contact.archived",
    scope: FieldScope.CONTACT,
    label: "Archived in Monday",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },

  // ---- Communication (email-centric, AXIS-owned) --------------------------
  {
    key: "communication.language",
    scope: FieldScope.COMMUNICATION,
    label: "Language",
    hint: "Held per email address, never guessed from a name.",
    valueKind: ValueKind.ENUM,
    choices: LANGUAGE_CHOICES,
    operators: ENUM_OPS,
    coverageNote:
      "Not set for any address yet — a Hebrew or Arabic send will exclude them.",
  },
  {
    key: "communication.consent",
    scope: FieldScope.COMMUNICATION,
    label: "Consent",
    valueKind: ValueKind.ENUM,
    choices: CONSENT_CHOICES,
    operators: ENUM_OPS,
  },
  {
    key: "communication.emailStatus",
    scope: FieldScope.COMMUNICATION,
    label: "Email address check",
    valueKind: ValueKind.ENUM,
    choices: EMAIL_STATUS_CHOICES,
    operators: ENUM_OPS,
  },
  {
    key: "communication.unsubscribed",
    scope: FieldScope.COMMUNICATION,
    label: "Unsubscribed",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },
  {
    key: "communication.suppressed",
    scope: FieldScope.COMMUNICATION,
    label: "Blocked (bounced or complained)",
    valueKind: ValueKind.NONE,
    operators: YES_NO_OPS,
  },
] as const;

const FIELD_BY_KEY = new Map(SEGMENT_FIELDS.map((f) => [f.key, f]));

export function findField(key: string): FieldDefinition | undefined {
  return FIELD_BY_KEY.get(key);
}

export function fieldsForScope(scope: FieldScope): FieldDefinition[] {
  return SEGMENT_FIELDS.filter((f) => f.scope === scope);
}

export const SCOPE_LABEL: Record<FieldScope, string> = {
  COMPANY: "Company",
  CONTACT: "Contact",
  PRODUCT: "Products owned",
  COMMUNICATION: "Email settings",
};

export const OPERATOR_LABEL: Record<Operator, string> = {
  EQUALS: "is exactly",
  CONTAINS: "contains",
  STARTS_WITH: "starts with",
  IS_EMPTY: "is empty",
  IS_NOT_EMPTY: "is not empty",
  IS: "is",
  IS_NOT: "is not",
  IS_ONE_OF: "is one of",
  BEFORE: "is before",
  AFTER: "is after",
  WITHIN_NEXT_DAYS: "expires within the next",
  EXPIRED: "has already expired",
  NOT_EXPIRED: "has not expired",
  IS_YES: "yes",
  IS_NO: "no",
  OWNS: "owns a product matching",
  DOES_NOT_OWN: "owns no product matching",
};

/** Operators that take no value at all. */
export function operatorTakesNoValue(operator: Operator): boolean {
  return (
    operator === Operator.IS_EMPTY ||
    operator === Operator.IS_NOT_EMPTY ||
    operator === Operator.EXPIRED ||
    operator === Operator.NOT_EXPIRED ||
    operator === Operator.IS_YES ||
    operator === Operator.IS_NO
  );
}

/** Operators that take a list of values rather than a single one. */
export function operatorTakesList(operator: Operator): boolean {
  return operator === Operator.IS_ONE_OF;
}
