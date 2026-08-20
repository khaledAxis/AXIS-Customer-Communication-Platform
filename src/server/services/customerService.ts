import type { Prisma } from "@prisma/client";

import { getPrisma } from "../db/prisma";

/**
 * Customer read use-cases for the Customers UI.
 *
 * Read-only: this platform never edits Monday-owned CRM fields (ADR-0007). The UI
 * calls these; it never touches Prisma directly.
 */

export const CUSTOMERS_PAGE_SIZE = 25;

export interface CustomerFilters {
  search?: string;
  status?: string;
  industryId?: string;
  classificationId?: string;
  page?: number;
}

function buildWhere(filters: CustomerFilters): Prisma.CompanyWhereInput {
  const where: Prisma.CompanyWhereInput = {};
  const and: Prisma.CompanyWhereInput[] = [];

  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { companyEmail: { contains: search, mode: "insensitive" } },
        { companyPhone: { contains: search, mode: "insensitive" } },
        { companyNumber: { contains: search, mode: "insensitive" } },
        { category: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (filters.status && filters.status !== "ALL") {
    and.push({ customerStatus: filters.status as "ACTIVE" | "INACTIVE" | "POTENTIAL" | "UNKNOWN" });
  }
  if (filters.industryId && filters.industryId !== "ALL") {
    and.push({ industryId: filters.industryId });
  }
  if (filters.classificationId && filters.classificationId !== "ALL") {
    and.push({ classificationId: filters.classificationId });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export async function listCustomers(filters: CustomerFilters) {
  const prisma = getPrisma();
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      // Active customers first: Postgres sorts NULLs last on ASC, which would otherwise
      // put every archived record at the top of page 1.
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      skip: (page - 1) * CUSTOMERS_PAGE_SIZE,
      take: CUSTOMERS_PAGE_SIZE,
      include: {
        industry: { select: { label: true } },
        classification: { select: { label: true } },
        _count: { select: { contactLinks: true, ownedProducts: true } },
      },
    }),
  ]);

  return {
    companies,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)),
  };
}

export async function getCustomer(id: string) {
  return getPrisma().company.findUnique({
    where: { id },
    include: {
      industry: { select: { label: true } },
      classification: { select: { label: true } },
      contactLinks: {
        include: { contact: true },
        orderBy: [{ createdAt: "asc" }],
      },
      ownedProducts: {
        include: { product: { select: { name: true, sku: true, itemType: true } } },
        orderBy: [{ subscriptionUntil: "desc" }],
      },
    },
  });
}

/**
 * Local communication state for a set of normalized emails.
 *
 * Kept separate from the CRM data on purpose: the UI must show clearly which fields
 * are Monday-owned and which are AXIS-local.
 */
export async function getCommunicationState(normalizedEmails: string[]) {
  if (normalizedEmails.length === 0) return new Map<string, CommunicationState>();

  const prisma = getPrisma();
  const [addresses, unsubscribes, suppressions] = await Promise.all([
    prisma.communicationAddress.findMany({ where: { normalizedEmail: { in: normalizedEmails } } }),
    prisma.unsubscribe.findMany({ where: { normalizedEmail: { in: normalizedEmails } } }),
    prisma.suppression.findMany({ where: { normalizedEmail: { in: normalizedEmails } } }),
  ]);

  const unsubscribed = new Set(unsubscribes.map((row) => row.normalizedEmail));
  const suppressed = new Set(suppressions.map((row) => row.normalizedEmail));

  return new Map<string, CommunicationState>(
    addresses.map((address) => [
      address.normalizedEmail,
      {
        id: address.id,
        normalizedEmail: address.normalizedEmail,
        language: address.language,
        consentStatus: address.consentStatus,
        emailStatus: address.emailStatus,
        isUnsubscribed: unsubscribed.has(address.normalizedEmail),
        isSuppressed: suppressed.has(address.normalizedEmail),
      },
    ]),
  );
}

export interface CommunicationState {
  /** Needed to target the address when staff assign a language (ADR-0020). */
  id: string;
  normalizedEmail: string;
  language: string;
  consentStatus: string;
  emailStatus: string;
  isUnsubscribed: boolean;
  isSuppressed: boolean;
}

export async function getCrmOverview() {
  const prisma = getPrisma();
  const [companies, contacts, products, customerProducts, addresses, lastRun, industries, classifications] =
    await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
      prisma.product.count(),
      prisma.customerProduct.count(),
      prisma.communicationAddress.count(),
      prisma.syncRun.findFirst({ orderBy: [{ startedAt: "desc" }] }),
      prisma.industry.findMany({ orderBy: [{ label: "asc" }], select: { id: true, label: true } }),
      prisma.customerClassification.findMany({
        orderBy: [{ label: "asc" }],
        select: { id: true, label: true },
      }),
    ]);

  return {
    companies,
    contacts,
    products,
    customerProducts,
    addresses,
    lastSyncAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
    lastSyncStatus: lastRun?.status ?? null,
    industries,
    classifications,
  };
}
