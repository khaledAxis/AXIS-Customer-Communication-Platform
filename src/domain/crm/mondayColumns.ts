/**
 * Real Monday board and column identifiers (ADR-0017).
 *
 * Every id here was read from the live boards, not guessed. Keeping them in one pure
 * module means the network adapter, the projections and the tests all agree, and a
 * board change is a one-file edit.
 *
 * Monday is the SOURCE OF TRUTH and this platform is a read-only projection: nothing
 * in this file is ever written back.
 */

export const MONDAY_BOARDS = {
  CUSTOMERS: "1903020743",
  CONTACTS: "1903020916",
  PRODUCTS: "1903021552",
  CUSTOMER_PRODUCTS: "1903021951",
} as const;

/** Customers / companies board — "לקוחות". */
export const CUSTOMER_COLUMNS = {
  category: "text_mkpry334",
  classification: "color_mm1gzaje",
  hashavshevetId: "text_mkpr2fze",
  companyNumber: "text_mkpsd6n8",
  /** Campaign candidate. */
  companyEmail: "email_mkprcghb",
  /** Bookkeeping address — NEVER a campaign candidate (ADR-0009). */
  accountingEmail: "email_mkpr3mn2",
  companyPhone: "phone_mkprqk5q",
  customerStatus: "color_mkpr7x4",
  industry: "color_mkprbck1",
  contactsRelation: "board_relation_mkpt5a3k",
  catalogueProductsRelation: "board_relation_mkrydxdp",
  ownedProductsRelation: "board_relation_mkpr7rp6",
} as const;

/** Contacts board — "אנשי קשר". */
export const CONTACT_COLUMNS = {
  phone: "phone_mkprfe9c",
  email: "email_mkprzf27",
  companyRelation: "board_relation_mkpt1ynj",
  industryMirror: "lookup_mkrkz7vm",
  jobTitle: "text_mkpry78y",
  address: "text_mksdmv2z",
} as const;

/** Product catalogue board — "מוצרים". */
export const PRODUCT_COLUMNS = {
  itemKey: "text_mkprmrge",
  sku: "text_mkprn1vc",
  catalogLink: "link_mkprhbqj",
  itemType: "color_mkprvvv3",
} as const;

/** Customer-owned products / subscriptions board — "מוצרי לקוח". */
export const CUSTOMER_PRODUCT_COLUMNS = {
  companyRelation: "board_relation_mkprnbwd",
  contactRelation: "board_relation_mkpr2y4r",
  productRelation: "board_relation_mkpr16w5",
  status: "color_mkprs8zd",
  purchaseDate: "date_mkprhjwz",
  hardwareWarrantyUntil: "date_mkprw9ap",
  softwareWarrantyUntil: "date_mkprz32n",
  subscriptionUntil: "date_mkpr26ng",
  subscriptionLoginId: "text_mkprsxmb",
  billingType: "color_mkprz4za",
  includesCommsPackage: "color_mkprnw7q",
  simCount: "numeric_mkpr96jn",
} as const;

/** Column ids fetched per board — nothing else is requested from Monday. */
export const REQUESTED_COLUMNS: Record<string, string[]> = {
  [MONDAY_BOARDS.CUSTOMERS]: Object.values(CUSTOMER_COLUMNS),
  [MONDAY_BOARDS.CONTACTS]: Object.values(CONTACT_COLUMNS),
  [MONDAY_BOARDS.PRODUCTS]: Object.values(PRODUCT_COLUMNS),
  [MONDAY_BOARDS.CUSTOMER_PRODUCTS]: Object.values(CUSTOMER_PRODUCT_COLUMNS),
};

/**
 * Monday customer-status labels → the normalized enum.
 *
 * Unrecognised labels become UNKNOWN and keep their raw text in `customerStatusRaw`,
 * so a renamed Monday label degrades instead of corrupting data.
 */
export function normalizeCustomerStatus(
  label: string | null | undefined,
): "POTENTIAL" | "ACTIVE" | "INACTIVE" | "UNKNOWN" {
  const value = (label ?? "").trim();
  if (value === "") return "UNKNOWN";

  if (/פוטנציאל|potential|lead/i.test(value)) return "POTENTIAL";
  if (/לא פעיל|inactive|closed|סגור/i.test(value)) return "INACTIVE";
  if (/פעיל|active/i.test(value)) return "ACTIVE";
  return "UNKNOWN";
}

/** Monday "yes/no" style status labels → boolean, or null when not set. */
export function parseYesNo(label: string | null | undefined): boolean | null {
  const value = (label ?? "").trim();
  if (value === "") return null;
  if (/^(כן|yes|true)$/i.test(value)) return true;
  if (/^(לא|no|false)$/i.test(value)) return false;
  return null;
}

/** Monday date text (YYYY-MM-DD) → Date, or null when absent/unparseable. */
export function parseMondayDate(text: string | null | undefined): Date | null {
  const value = (text ?? "").trim();
  if (value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Monday numeric text → integer, or null. */
export function parseMondayInt(text: string | null | undefined): number | null {
  const value = (text ?? "").trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
