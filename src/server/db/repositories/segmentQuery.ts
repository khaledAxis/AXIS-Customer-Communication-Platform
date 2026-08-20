import type { Prisma } from "@prisma/client";

import {
  GroupMatch,
  SegmentCondition,
  SegmentDefinition,
  SegmentGroup,
} from "../../../domain/segment/segmentDefinition";
import { FieldScope, Operator, findField } from "../../../domain/segment/segmentFields";

/**
 * Translates a validated segment definition into Prisma filters.
 *
 * The stored segment is data, never SQL and never code (ADR-0018) — this module
 * is the only place that turns it into a query, and it can only produce the
 * clauses written here. An unknown field or operator cannot reach this code:
 * `parseSegmentDefinition` rejects it first, and every switch below is
 * exhaustive over the catalogue.
 *
 * Filtering happens in the database, not in JavaScript, so the audience preview
 * stays fast as the CRM grows.
 */

const INSENSITIVE = "insensitive" as const;

type StringFilter = Prisma.StringFilter | Prisma.StringNullableFilter;

/** Text operators shared by every free-text field. */
function textFilter(operator: Operator, value: string): StringFilter | null {
  switch (operator) {
    case Operator.EQUALS:
      return { equals: value, mode: INSENSITIVE };
    case Operator.CONTAINS:
    case Operator.OWNS:
      return { contains: value, mode: INSENSITIVE };
    case Operator.STARTS_WITH:
      return { startsWith: value, mode: INSENSITIVE };
    default:
      return null;
  }
}

/** "is empty" has to cover both NULL and the empty string a CRM export leaves behind. */
function emptyClause<T>(column: string, empty: boolean): T {
  return (
    empty
      ? { OR: [{ [column]: null }, { [column]: "" }] }
      : { AND: [{ [column]: { not: null } }, { [column]: { not: "" } }] }
  ) as T;
}

function dateFilter(
  condition: SegmentCondition,
  now: Date,
): Prisma.DateTimeNullableFilter | null {
  switch (condition.operator) {
    case Operator.BEFORE:
      return { lt: new Date(condition.value as string) };
    case Operator.AFTER:
      return { gt: new Date(condition.value as string) };
    case Operator.WITHIN_NEXT_DAYS: {
      const until = new Date(now.getTime() + (condition.days ?? 0) * 86_400_000);
      return { gte: now, lte: until };
    }
    case Operator.EXPIRED:
      return { lt: now };
    case Operator.NOT_EXPIRED:
      return { gte: now };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Company scope
// ---------------------------------------------------------------------------

function companyClause(
  condition: SegmentCondition,
): Prisma.CompanyWhereInput | null {
  const { operator, value, values } = condition;

  switch (condition.field) {
    case "company.status": {
      const status = value as Prisma.EnumCompanyCrmStatusFilter["equals"];
      if (operator === Operator.IS) return { customerStatus: status };
      if (operator === Operator.IS_NOT) return { customerStatus: { not: status } };
      if (operator === Operator.IS_ONE_OF) {
        return {
          customerStatus: {
            in: values as Prisma.EnumCompanyCrmStatusFilter["in"],
          },
        };
      }
      return null;
    }

    // Lookup fields carry the Monday *label*, matched case-insensitively.
    case "company.classification":
      return lookupClause("classification", "classificationId", condition);
    case "company.industry":
      return lookupClause("industry", "industryId", condition);

    case "company.category":
    case "company.name": {
      const column = condition.field === "company.category" ? "category" : "name";
      if (operator === Operator.IS_EMPTY) return emptyClause(column, true);
      if (operator === Operator.IS_NOT_EMPTY) return emptyClause(column, false);
      const filter = textFilter(operator, value ?? "");
      return filter ? ({ [column]: filter } as Prisma.CompanyWhereInput) : null;
    }

    case "company.email":
      // The accounting address is never a segmentation field — only the
      // campaign address exists here (ADR-0009).
      return operator === Operator.IS_EMPTY
        ? emptyClause("companyEmailNorm", true)
        : emptyClause("companyEmailNorm", false);

    case "company.archived":
      return operator === Operator.IS_YES
        ? { archivedAt: { not: null } }
        : { archivedAt: null };

    default:
      return null;
  }
}

function lookupClause(
  relation: "classification" | "industry",
  idColumn: "classificationId" | "industryId",
  condition: SegmentCondition,
): Prisma.CompanyWhereInput | null {
  const { operator, value, values } = condition;

  if (operator === Operator.IS_EMPTY) return { [idColumn]: null };
  if (operator === Operator.IS_NOT_EMPTY) return { [idColumn]: { not: null } };

  if (operator === Operator.IS) {
    return { [relation]: { label: { equals: value, mode: INSENSITIVE } } };
  }
  if (operator === Operator.IS_NOT) {
    return {
      NOT: { [relation]: { label: { equals: value, mode: INSENSITIVE } } },
    };
  }
  if (operator === Operator.IS_ONE_OF) {
    return {
      OR: (values ?? []).map((v) => ({
        [relation]: { label: { equals: v, mode: INSENSITIVE } },
      })),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Product scope — every product condition constrains the company's owned products
// ---------------------------------------------------------------------------

/**
 * One product condition as a filter on a single `CustomerProduct` row.
 * Returns `negate` for "owns no product matching", which becomes a `none` clause.
 */
function ownedProductFilter(
  condition: SegmentCondition,
  now: Date,
): { filter: Prisma.CustomerProductWhereInput; negate: boolean } | null {
  const { operator, value, values } = condition;
  const negate = operator === Operator.DOES_NOT_OWN;

  switch (condition.field) {
    case "product.any":
      // No filter at all: "has at least one owned product row" (or none of them).
      return { filter: {}, negate: operator === Operator.IS_NO };

    case "product.name": {
      if (operator === Operator.IS_EMPTY || operator === Operator.IS_NOT_EMPTY) {
        return null;
      }
      const filter = textFilter(
        negate ? Operator.CONTAINS : operator,
        value ?? "",
      );
      return filter ? { filter: { product: { name: filter } }, negate } : null;
    }

    case "product.sku": {
      if (operator === Operator.IS_EMPTY) {
        return { filter: { product: { OR: [{ sku: null }, { sku: "" }] } }, negate };
      }
      if (operator === Operator.IS_NOT_EMPTY) {
        return {
          filter: {
            product: { AND: [{ sku: { not: null } }, { sku: { not: "" } }] },
          },
          negate,
        };
      }
      const filter = textFilter(operator, value ?? "");
      return filter ? { filter: { product: { sku: filter } }, negate } : null;
    }

    case "product.type": {
      if (operator === Operator.IS) {
        return {
          filter: { product: { itemType: { equals: value, mode: INSENSITIVE } } },
          negate,
        };
      }
      if (operator === Operator.IS_NOT) {
        return {
          filter: { product: { itemType: { equals: value, mode: INSENSITIVE } } },
          negate: true,
        };
      }
      if (operator === Operator.IS_ONE_OF) {
        return {
          filter: {
            product: {
              OR: (values ?? []).map((v) => ({
                itemType: { equals: v, mode: INSENSITIVE },
              })),
            },
          },
          negate,
        };
      }
      return null;
    }

    case "customerProduct.status": {
      if (operator === Operator.IS_EMPTY) {
        return { filter: { OR: [{ status: null }, { status: "" }] }, negate };
      }
      if (operator === Operator.IS_NOT_EMPTY) {
        return {
          filter: { AND: [{ status: { not: null } }, { status: { not: "" } }] },
          negate,
        };
      }
      const filter = textFilter(operator, value ?? "");
      return filter ? { filter: { status: filter }, negate } : null;
    }

    case "customerProduct.subscriptionUntil":
    case "customerProduct.softwareWarrantyUntil":
    case "customerProduct.hardwareWarrantyUntil":
    case "customerProduct.purchaseDate": {
      const column = condition.field.split(".")[1];
      const filter = dateFilter(condition, now);
      return filter
        ? { filter: { [column]: filter } as Prisma.CustomerProductWhereInput, negate }
        : null;
    }

    default:
      return null;
  }
}

/**
 * Product conditions combined with AND mean "owns ONE product satisfying all of
 * them" — a Trimble subscription expiring soon, not a Trimble plus some other
 * product expiring soon. That is what staff mean, and the UI says so.
 */
function productClauseAll(
  conditions: SegmentCondition[],
  now: Date,
): Prisma.CompanyWhereInput[] {
  const positives: Prisma.CustomerProductWhereInput[] = [];
  const negatives: Prisma.CustomerProductWhereInput[] = [];

  for (const condition of conditions) {
    const built = ownedProductFilter(condition, now);
    if (!built) continue;
    (built.negate ? negatives : positives).push(built.filter);
  }

  const clauses: Prisma.CompanyWhereInput[] = [];
  if (positives.length > 0) {
    clauses.push({ ownedProducts: { some: { AND: positives } } });
  }
  for (const negative of negatives) {
    clauses.push({ ownedProducts: { none: negative } });
  }
  return clauses;
}

/** ANY group: owns a product matching at least one of the conditions. */
function productClauseAny(
  conditions: SegmentCondition[],
  now: Date,
): Prisma.CompanyWhereInput | null {
  const alternatives: Prisma.CompanyWhereInput[] = [];
  for (const condition of conditions) {
    const built = ownedProductFilter(condition, now);
    if (!built) continue;
    alternatives.push(
      built.negate
        ? { ownedProducts: { none: built.filter } }
        : { ownedProducts: { some: built.filter } },
    );
  }
  return alternatives.length > 0 ? { OR: alternatives } : null;
}

// ---------------------------------------------------------------------------
// Contact scope
// ---------------------------------------------------------------------------

function contactClause(
  condition: SegmentCondition,
): Prisma.ContactWhereInput | null {
  const { operator, value } = condition;

  switch (condition.field) {
    case "contact.name":
    case "contact.jobTitle": {
      const column = condition.field === "contact.name" ? "fullName" : "jobTitle";
      if (operator === Operator.IS_EMPTY) return emptyClause(column, true);
      if (operator === Operator.IS_NOT_EMPTY) return emptyClause(column, false);
      const filter = textFilter(operator, value ?? "");
      return filter ? ({ [column]: filter } as Prisma.ContactWhereInput) : null;
    }

    case "contact.email":
      return operator === Operator.IS_EMPTY
        ? emptyClause("emailNorm", true)
        : emptyClause("emailNorm", false);

    case "contact.archived":
      return operator === Operator.IS_YES
        ? { archivedAt: { not: null } }
        : { archivedAt: null };

    case "contact.hasCompany":
      return operator === Operator.IS_YES
        ? { companyLinks: { some: {} } }
        : { companyLinks: { none: {} } };

    case "contact.companyName": {
      const filter = textFilter(operator, value ?? "");
      return filter
        ? { companyLinks: { some: { company: { name: filter } } } }
        : null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function scopeOf(condition: SegmentCondition): FieldScope | null {
  return findField(condition.field)?.scope ?? null;
}

function groupScope(group: SegmentGroup): FieldScope | null {
  return group.conditions.length > 0 ? scopeOf(group.conditions[0]) : null;
}

/**
 * Company-side filter: company conditions plus product-ownership conditions.
 * `undefined` means "no company constraint at all".
 */
export function buildCompanyWhere(
  definition: SegmentDefinition,
  now: Date,
): Prisma.CompanyWhereInput | undefined {
  const and: Prisma.CompanyWhereInput[] = [];

  for (const condition of definition.conditions) {
    if (scopeOf(condition) !== FieldScope.COMPANY) continue;
    const clause = companyClause(condition);
    if (clause) and.push(clause);
  }

  const topProduct = definition.conditions.filter(
    (c) => scopeOf(c) === FieldScope.PRODUCT,
  );
  and.push(...productClauseAll(topProduct, now));

  for (const group of definition.groups) {
    const scope = groupScope(group);

    if (scope === FieldScope.COMPANY) {
      const clauses = group.conditions
        .map(companyClause)
        .filter((c): c is Prisma.CompanyWhereInput => c !== null);
      if (clauses.length === 0) continue;
      and.push(group.match === GroupMatch.ANY ? { OR: clauses } : { AND: clauses });
      continue;
    }

    if (scope === FieldScope.PRODUCT) {
      if (group.match === GroupMatch.ANY) {
        const clause = productClauseAny(group.conditions, now);
        if (clause) and.push(clause);
      } else {
        and.push(...productClauseAll(group.conditions, now));
      }
    }
  }

  return and.length > 0 ? { AND: and } : undefined;
}

/**
 * Contact-side filter from contact conditions only. `undefined` means "no
 * contact constraint"; the company constraint is applied separately so that a
 * contact still has to belong to a matching company.
 */
export function buildContactWhere(
  definition: SegmentDefinition,
): Prisma.ContactWhereInput | undefined {
  const and: Prisma.ContactWhereInput[] = [];

  for (const condition of definition.conditions) {
    if (scopeOf(condition) !== FieldScope.CONTACT) continue;
    const clause = contactClause(condition);
    if (clause) and.push(clause);
  }

  for (const group of definition.groups) {
    if (groupScope(group) !== FieldScope.CONTACT) continue;
    const clauses = group.conditions
      .map(contactClause)
      .filter((c): c is Prisma.ContactWhereInput => c !== null);
    if (clauses.length === 0) continue;
    and.push(group.match === GroupMatch.ANY ? { OR: clauses } : { AND: clauses });
  }

  return and.length > 0 ? { AND: and } : undefined;
}

/** True when the definition constrains companies or the products they own. */
export function hasCompanyConstraint(definition: SegmentDefinition): boolean {
  const inTop = definition.conditions.some((c) => {
    const scope = scopeOf(c);
    return scope === FieldScope.COMPANY || scope === FieldScope.PRODUCT;
  });
  const inGroups = definition.groups.some((g) => {
    const scope = groupScope(g);
    return scope === FieldScope.COMPANY || scope === FieldScope.PRODUCT;
  });
  return inTop || inGroups;
}

// ---------------------------------------------------------------------------
// Communication scope — evaluated against the address, not the CRM record
// ---------------------------------------------------------------------------

export interface AddressFacts {
  language: string;
  consentStatus: string;
  emailStatus: string;
  isUnsubscribed: boolean;
  isSuppressed: boolean;
}

function matchesCommunicationCondition(
  condition: SegmentCondition,
  facts: AddressFacts,
): boolean {
  const { operator, value, values } = condition;

  const compareEnum = (actual: string): boolean => {
    if (operator === Operator.IS) return actual === value;
    if (operator === Operator.IS_NOT) return actual !== value;
    if (operator === Operator.IS_ONE_OF) return (values ?? []).includes(actual);
    return false;
  };

  switch (condition.field) {
    case "communication.language":
      return compareEnum(facts.language);
    case "communication.consent":
      return compareEnum(facts.consentStatus);
    case "communication.emailStatus":
      return compareEnum(facts.emailStatus);
    case "communication.unsubscribed":
      return operator === Operator.IS_YES ? facts.isUnsubscribed : !facts.isUnsubscribed;
    case "communication.suppressed":
      return operator === Operator.IS_YES ? facts.isSuppressed : !facts.isSuppressed;
    default:
      return false;
  }
}

/**
 * Applies the communication conditions to one candidate address.
 *
 * A candidate that fails here was never in the segment — it is NOT an
 * exclusion. Exclusions are produced later, by eligibility, and only for
 * addresses the segment actually selected (CLAUDE.md: segmentation and
 * eligibility are separate stages).
 */
export function matchesCommunication(
  definition: SegmentDefinition,
  facts: AddressFacts,
): boolean {
  for (const condition of definition.conditions) {
    if (scopeOf(condition) !== FieldScope.COMMUNICATION) continue;
    if (!matchesCommunicationCondition(condition, facts)) return false;
  }

  for (const group of definition.groups) {
    if (groupScope(group) !== FieldScope.COMMUNICATION) continue;
    const results = group.conditions.map((c) =>
      matchesCommunicationCondition(c, facts),
    );
    const ok =
      group.match === GroupMatch.ANY
        ? results.some(Boolean)
        : results.every(Boolean);
    if (!ok) return false;
  }

  return true;
}

/** True when the definition filters on email settings at all. */
export function hasCommunicationConstraint(
  definition: SegmentDefinition,
): boolean {
  return (
    definition.conditions.some((c) => scopeOf(c) === FieldScope.COMMUNICATION) ||
    definition.groups.some((g) => groupScope(g) === FieldScope.COMMUNICATION)
  );
}
