import type { Prisma } from "@prisma/client";

import {
  ConsentAssignmentError,
  ConsentCounts,
  parseConsentAssignment,
  projectConsentCounts,
  type ConsentAssignmentInput,
} from "../../domain/communication/consentAssignment";
import {
  LanguageAssignmentError,
  LanguageCounts,
  parseLanguageAssignment,
  projectLanguageCounts,
} from "../../domain/communication/languageAssignment";
import {
  ConsentSource,
  ConsentStatus,
  EmailSourceType,
  EmailStatus,
  Language,
} from "../../domain/types";
import { getPrisma } from "../db/prisma";
import { getAuthoringUserId } from "./newsletterService";

/**
 * Communication settings: the AXIS-owned, sync-immune profile per email address
 * (ADR-0009), and the staff workflow for assigning language (ADR-0020).
 *
 * What this service can change: `CommunicationAddress.language` and
 * `CommunicationAddress.consentStatus` (with its evidence), through two SEPARATE
 * functions whose update payloads share no field. Email status, unsubscribe and
 * suppression have no write path here at all.
 *
 * Language and consent stay independent by construction: `setLanguage` cannot write a
 * consent column and `setConsent` cannot write the language column, so assigning
 * Hebrew can never imply permission to email someone. Consent GRANTED likewise never
 * overrides an unsubscribe or a suppression — those are enforced downstream by the one
 * eligibility engine, which this service does not touch.
 *
 * Monday is untouched: this platform is a read-only projection of the CRM and holds
 * language and consent locally precisely because Monday has no columns for them.
 */

export const COMMUNICATION_PAGE_SIZE = 25;

export interface CommunicationFilters {
  search?: string;
  language?: string;
  consent?: string;
  emailStatus?: string;
  /** "UNSUBSCRIBED" | "SUPPRESSED" | "SENDABLE" | "ALL" */
  state?: string;
  /** CRM context: classification label, category text, company name. */
  classification?: string;
  category?: string;
  company?: string;
  /** "COMPANY" | "CONTACT" | "ALL" — which kind of CRM record contributed it. */
  sourceKind?: string;
  page?: number;
}

export interface AddressSource {
  kind: EmailSourceType;
  /** Friendly name — never a database or Monday id. */
  label: string;
  /** Company name for a contact source, so staff can place the person. */
  companyName?: string | null;
}

export interface CommunicationRow {
  id: string;
  normalizedEmail: string;
  language: Language;
  consentStatus: ConsentStatus;
  /** Evidence recorded with a GRANTED consent; null for UNKNOWN and DENIED. */
  consentSource: ConsentSource | null;
  consentNote: string | null;
  consentEffectiveAt: Date | null;
  consentRecordedAt: Date | null;
  emailStatus: EmailStatus;
  isUnsubscribed: boolean;
  isSuppressed: boolean;
  sourceCount: number;
  sources: AddressSource[];
  updatedAt: Date;
}

export interface CommunicationPage {
  rows: CommunicationRow[];
  total: number;
  page: number;
  pageCount: number;
  /** Ids of every address matching the filter, for "select all matching". */
  allMatchingIds: string[];
  matchingTruncated: boolean;
}

/** Cap on "select all matching" so one click cannot queue an unbounded write. */
const MAX_SELECT_ALL = 2_000;

function has(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && value !== "ALL";
}

/**
 * CRM-context filters resolve to a set of normalized emails, because
 * `CommunicationAddress` is linked to the CRM only by the address itself — there is
 * no foreign key, by design (ADR-0009: email is never CRM identity).
 */
async function crmEmailFilter(
  prisma: ReturnType<typeof getPrisma>,
  filters: CommunicationFilters,
): Promise<string[] | null> {
  const wantsCompanyContext =
    has(filters.classification) || has(filters.category) || has(filters.company);
  const wantsSourceKind = has(filters.sourceKind);

  if (!wantsCompanyContext && !wantsSourceKind) return null;

  const companyWhere: Prisma.CompanyWhereInput = {};
  const and: Prisma.CompanyWhereInput[] = [];
  if (has(filters.classification)) {
    and.push({
      classification: { label: { equals: filters.classification, mode: "insensitive" } },
    });
  }
  if (has(filters.category)) {
    and.push({ category: { contains: filters.category, mode: "insensitive" } });
  }
  if (has(filters.company)) {
    and.push({ name: { contains: filters.company, mode: "insensitive" } });
  }
  if (and.length > 0) companyWhere.AND = and;

  const kind = filters.sourceKind;
  const emails = new Set<string>();

  // Company campaign addresses. The accounting address has no code path (ADR-0009).
  if (kind !== EmailSourceType.CONTACT_EMAIL) {
    const companies = await prisma.company.findMany({
      where: { ...companyWhere, companyEmailNorm: { not: null } },
      select: { companyEmailNorm: true },
    });
    for (const row of companies) {
      if (row.companyEmailNorm) emails.add(row.companyEmailNorm);
    }
  }

  // Contact addresses, constrained to matching companies when a company filter is set.
  if (kind !== EmailSourceType.COMPANY_EMAIL) {
    const contacts = await prisma.contact.findMany({
      where: {
        emailNorm: { not: null },
        ...(and.length > 0
          ? { companyLinks: { some: { company: companyWhere } } }
          : {}),
      },
      select: { emailNorm: true },
    });
    for (const row of contacts) {
      if (row.emailNorm) emails.add(row.emailNorm);
    }
  }

  return [...emails];
}

function buildWhere(
  filters: CommunicationFilters,
  crmEmails: string[] | null,
  unsubscribed: Set<string>,
  suppressed: Set<string>,
): Prisma.CommunicationAddressWhereInput {
  const and: Prisma.CommunicationAddressWhereInput[] = [];

  if (has(filters.search)) {
    and.push({
      normalizedEmail: { contains: filters.search.trim(), mode: "insensitive" },
    });
  }
  if (has(filters.language)) {
    and.push({ language: filters.language as Language });
  }
  if (has(filters.consent)) {
    and.push({ consentStatus: filters.consent as ConsentStatus });
  }
  if (has(filters.emailStatus)) {
    and.push({ emailStatus: filters.emailStatus as EmailStatus });
  }
  if (crmEmails !== null) {
    and.push({ normalizedEmail: { in: crmEmails } });
  }

  const blocked = [...new Set([...unsubscribed, ...suppressed])];
  if (filters.state === "UNSUBSCRIBED") {
    and.push({ normalizedEmail: { in: [...unsubscribed] } });
  } else if (filters.state === "SUPPRESSED") {
    and.push({ normalizedEmail: { in: [...suppressed] } });
  } else if (filters.state === "SENDABLE") {
    and.push({ normalizedEmail: { notIn: blocked } });
  }

  return and.length > 0 ? { AND: and } : {};
}

export async function listCommunicationAddresses(
  filters: CommunicationFilters,
): Promise<CommunicationPage> {
  const prisma = getPrisma();
  const page = Math.max(1, filters.page ?? 1);

  const [crmEmails, unsubRows, suppRows] = await Promise.all([
    crmEmailFilter(prisma, filters),
    prisma.unsubscribe.findMany({ select: { normalizedEmail: true } }),
    prisma.suppression.findMany({ select: { normalizedEmail: true } }),
  ]);

  const unsubscribed = new Set(unsubRows.map((r) => r.normalizedEmail));
  const suppressed = new Set(suppRows.map((r) => r.normalizedEmail));
  const where = buildWhere(filters, crmEmails, unsubscribed, suppressed);

  const [total, addresses, matching] = await Promise.all([
    prisma.communicationAddress.count({ where }),
    prisma.communicationAddress.findMany({
      where,
      orderBy: [{ normalizedEmail: "asc" }],
      skip: (page - 1) * COMMUNICATION_PAGE_SIZE,
      take: COMMUNICATION_PAGE_SIZE,
    }),
    prisma.communicationAddress.findMany({
      where,
      orderBy: [{ normalizedEmail: "asc" }],
      take: MAX_SELECT_ALL,
      select: { id: true },
    }),
  ]);

  const emails = addresses.map((a) => a.normalizedEmail);
  const sources = await loadSources(prisma, emails);

  return {
    rows: addresses.map((address) => ({
      id: address.id,
      normalizedEmail: address.normalizedEmail,
      language: address.language as Language,
      consentStatus: address.consentStatus as ConsentStatus,
      consentSource: (address.consentSource as ConsentSource | null) ?? null,
      consentNote: address.consentNote,
      consentEffectiveAt: address.consentEffectiveAt,
      consentRecordedAt: address.consentRecordedAt,
      emailStatus: address.emailStatus as EmailStatus,
      isUnsubscribed: unsubscribed.has(address.normalizedEmail),
      isSuppressed: suppressed.has(address.normalizedEmail),
      sourceCount: sources.get(address.normalizedEmail)?.length ?? 0,
      sources: sources.get(address.normalizedEmail) ?? [],
      updatedAt: address.updatedAt,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / COMMUNICATION_PAGE_SIZE)),
    allMatchingIds: matching.map((row) => row.id),
    matchingTruncated: total > matching.length,
  };
}

/**
 * Every CRM record that contributed an address.
 *
 * One address commonly belongs to several records — a company and two of its
 * contacts, for example. They share ONE communication profile, which is exactly what
 * the UI has to make obvious before someone changes it.
 */
async function loadSources(
  prisma: ReturnType<typeof getPrisma>,
  emails: string[],
): Promise<Map<string, AddressSource[]>> {
  const map = new Map<string, AddressSource[]>();
  if (emails.length === 0) return map;

  const [companies, contacts] = await Promise.all([
    prisma.company.findMany({
      where: { companyEmailNorm: { in: emails } },
      select: { name: true, companyEmailNorm: true },
    }),
    prisma.contact.findMany({
      where: { emailNorm: { in: emails } },
      select: {
        fullName: true,
        emailNorm: true,
        companyLinks: {
          select: { company: { select: { name: true } } },
          take: 1,
        },
      },
    }),
  ]);

  const push = (email: string, source: AddressSource) => {
    const list = map.get(email);
    if (list) list.push(source);
    else map.set(email, [source]);
  };

  for (const company of companies) {
    if (!company.companyEmailNorm) continue;
    push(company.companyEmailNorm, {
      kind: EmailSourceType.COMPANY_EMAIL,
      label: company.name ?? "Company without a name",
    });
  }
  for (const contact of contacts) {
    if (!contact.emailNorm) continue;
    push(contact.emailNorm, {
      kind: EmailSourceType.CONTACT_EMAIL,
      label: contact.fullName ?? "Contact without a name",
      companyName: contact.companyLinks[0]?.company?.name ?? null,
    });
  }

  return map;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export async function getLanguageCounts(): Promise<LanguageCounts> {
  const grouped = await getPrisma().communicationAddress.groupBy({
    by: ["language"],
    _count: { _all: true },
  });

  const counts: LanguageCounts = { UNKNOWN: 0, HE: 0, AR: 0 };
  for (const row of grouped) {
    const key = row.language as keyof LanguageCounts;
    if (key in counts) counts[key] = row._count._all;
  }
  return counts;
}

export async function getConsentCounts(): Promise<ConsentCounts> {
  const grouped = await getPrisma().communicationAddress.groupBy({
    by: ["consentStatus"],
    _count: { _all: true },
  });

  const counts: ConsentCounts = { UNKNOWN: 0, GRANTED: 0, DENIED: 0 };
  for (const row of grouped) {
    const key = row.consentStatus as keyof ConsentCounts;
    if (key in counts) counts[key] = row._count._all;
  }
  return counts;
}

/** Distinct classification labels, for the CRM-context filter. */
export async function getFilterOptions() {
  const prisma = getPrisma();
  const [classifications, counts, consent] = await Promise.all([
    prisma.customerClassification.findMany({
      select: { label: true },
      orderBy: [{ label: "asc" }],
    }),
    getLanguageCounts(),
    getConsentCounts(),
  ]);
  return { classifications: classifications.map((c) => c.label), counts, consent };
}

// ---------------------------------------------------------------------------
// Writing language — the only mutation in this service
// ---------------------------------------------------------------------------

export interface LanguageChangeResult {
  changed: number;
  unchanged: number;
  language: Language;
  before: LanguageCounts;
  after: LanguageCounts;
  batchId: string | null;
}

/**
 * Assigns language to one or more addresses.
 *
 * Writes `language` and nothing else: the update payload has no other field, so
 * consent, email status, unsubscribe and suppression cannot be touched even by
 * accident. Each change is audited with its before/after value.
 */
export async function setLanguage(
  input: { language: unknown; addressIds: unknown },
  options: { batchId?: string | null } = {},
): Promise<LanguageChangeResult> {
  const { language, addressIds } = parseLanguageAssignment(input);
  const prisma = getPrisma();

  const existing = await prisma.communicationAddress.findMany({
    where: { id: { in: addressIds } },
    select: { id: true, normalizedEmail: true, language: true },
  });

  if (existing.length === 0) {
    throw new LanguageAssignmentError("NO_ADDRESSES_SELECTED");
  }

  const before = await getLanguageCounts();
  const toChange = existing.filter((row) => row.language !== language);
  const batchId =
    options.batchId ?? (existing.length > 1 ? `bulk-${Date.now().toString(36)}` : null);

  if (toChange.length === 0) {
    return {
      changed: 0,
      unchanged: existing.length,
      language,
      before,
      after: before,
      batchId,
    };
  }

  const actorUserId = await getAuthoringUserId();

  await prisma.$transaction(async (tx) => {
    await tx.communicationAddress.updateMany({
      where: { id: { in: toChange.map((row) => row.id) } },
      // Only `language`. No other column appears in this payload, deliberately.
      data: { language },
    });

    await tx.auditLog.createMany({
      data: toChange.map((row) => ({
        action: "COMMUNICATION_LANGUAGE_CHANGED" as const,
        actorUserId,
        entityType: "CommunicationAddress",
        entityId: row.id,
        fromState: row.language,
        toState: language,
        // The address is operational data, not a secret; no credential is recorded.
        metadata: batchId
          ? { normalizedEmail: row.normalizedEmail, batchId }
          : { normalizedEmail: row.normalizedEmail },
      })),
    });
  });

  const after = await getLanguageCounts();

  return {
    changed: toChange.length,
    unchanged: existing.length - toChange.length,
    language,
    before,
    after,
    batchId,
  };
}

/**
 * What the counts would become, without writing anything. Used for the confirmation
 * step so staff see "Hebrew 0 → 120" before committing.
 */
export async function previewLanguageImpact(
  addressIds: string[],
  language: Language,
): Promise<{ selected: number; before: LanguageCounts; after: LanguageCounts }> {
  const prisma = getPrisma();
  const rows = await prisma.communicationAddress.findMany({
    where: { id: { in: addressIds } },
    select: { language: true },
  });
  const before = await getLanguageCounts();
  return {
    selected: rows.length,
    before,
    after: projectLanguageCounts(
      before,
      rows.map((row) => row.language as Language),
      language,
    ),
  };
}

/** Recent language changes, newest first — the visible audit trail. */
export async function recentLanguageChanges(limit = 20) {
  return getPrisma().auditLog.findMany({
    where: { action: "COMMUNICATION_LANGUAGE_CHANGED" },
    orderBy: [{ occurredAt: "desc" }],
    take: limit,
    select: {
      id: true,
      entityId: true,
      fromState: true,
      toState: true,
      occurredAt: true,
      metadata: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Writing consent — the second, entirely separate mutation in this service
// ---------------------------------------------------------------------------

export interface ConsentChangeResult {
  changed: number;
  unchanged: number;
  status: ConsentStatus;
  source: ConsentSource | null;
  effectiveAt: Date | null;
  before: ConsentCounts;
  after: ConsentCounts;
  batchId: string | null;
}

/**
 * Records consent for one or more addresses.
 *
 * Writes `consentStatus` plus its evidence and nothing else: `language`,
 * `emailStatus`, unsubscribe and suppression do not appear in the update payload, so
 * they cannot be touched even by accident. Every change is audited with its
 * before/after value, the recorded basis, and the batch id when it was part of a bulk
 * operation.
 *
 * Recording GRANTED does NOT make anyone eligible on its own. Eligibility is derived
 * downstream, where an unsubscribe or a suppression still wins — see
 * `domain/eligibility`. This function cannot reach either of them.
 */
export async function setConsent(
  input: ConsentAssignmentInput,
  options: { batchId?: string | null } = {},
): Promise<ConsentChangeResult> {
  const assignment = parseConsentAssignment(input);
  const prisma = getPrisma();

  const existing = await prisma.communicationAddress.findMany({
    where: { id: { in: assignment.addressIds } },
    select: { id: true, normalizedEmail: true, consentStatus: true },
  });

  if (existing.length === 0) {
    throw new ConsentAssignmentError("NO_ADDRESSES_SELECTED");
  }

  const before = await getConsentCounts();

  // Re-recording the same status is still a real change when the basis or the
  // effective date differs, so GRANTED always writes; the other statuses are a no-op
  // when nothing would move.
  const toChange =
    assignment.status === ConsentStatus.GRANTED
      ? existing
      : existing.filter((row) => row.consentStatus !== assignment.status);

  const batchId =
    options.batchId ??
    (existing.length > 1 ? `consent-${Date.now().toString(36)}` : null);

  if (toChange.length === 0) {
    return {
      changed: 0,
      unchanged: existing.length,
      status: assignment.status,
      source: assignment.source,
      effectiveAt: assignment.effectiveAt,
      before,
      after: before,
      batchId,
    };
  }

  const actorUserId = await getAuthoringUserId();
  const recordedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.communicationAddress.updateMany({
      where: { id: { in: toChange.map((row) => row.id) } },
      // Consent and its evidence only. No language, no emailStatus, no unsubscribe
      // and no suppression field appears in this payload, deliberately.
      data: {
        consentStatus: assignment.status,
        consentSource: assignment.source,
        consentNote: assignment.note,
        consentEffectiveAt: assignment.effectiveAt,
        consentRecordedAt: recordedAt,
        consentRecordedById: actorUserId,
        consentBatchId: batchId,
      },
    });

    await tx.auditLog.createMany({
      data: toChange.map((row) => ({
        action: "COMMUNICATION_CONSENT_CHANGED" as const,
        actorUserId,
        entityType: "CommunicationAddress",
        entityId: row.id,
        fromState: row.consentStatus,
        toState: assignment.status,
        reason: assignment.note,
        // The address is operational data, not a secret; no credential is recorded.
        // Audit rows are append-only: a later change adds a row, never edits one.
        metadata: {
          normalizedEmail: row.normalizedEmail,
          source: assignment.source,
          effectiveAt: assignment.effectiveAt?.toISOString() ?? null,
          ...(batchId ? { batchId } : {}),
        },
      })),
    });
  });

  const after = await getConsentCounts();

  return {
    changed: toChange.length,
    unchanged: existing.length - toChange.length,
    status: assignment.status,
    source: assignment.source,
    effectiveAt: assignment.effectiveAt,
    before,
    after,
    batchId,
  };
}

/**
 * What the counts would become, without writing anything. Used for the confirmation
 * step so staff see "Approved 0 → 47" before committing.
 */
export async function previewConsentImpact(
  addressIds: string[],
  status: ConsentStatus,
): Promise<{ selected: number; before: ConsentCounts; after: ConsentCounts }> {
  const prisma = getPrisma();
  const rows = await prisma.communicationAddress.findMany({
    where: { id: { in: addressIds } },
    select: { consentStatus: true },
  });
  const before = await getConsentCounts();
  return {
    selected: rows.length,
    before,
    after: projectConsentCounts(
      before,
      rows.map((row) => row.consentStatus as ConsentStatus),
      status,
    ),
  };
}

/** Recent consent changes, newest first — the visible audit trail. */
export async function recentConsentChanges(limit = 20) {
  return getPrisma().auditLog.findMany({
    where: { action: "COMMUNICATION_CONSENT_CHANGED" },
    orderBy: [{ occurredAt: "desc" }],
    take: limit,
    select: {
      id: true,
      entityId: true,
      fromState: true,
      toState: true,
      reason: true,
      occurredAt: true,
      metadata: true,
    },
  });
}
