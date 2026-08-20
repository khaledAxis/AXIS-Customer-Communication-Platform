import type { PrismaClient } from "@prisma/client";

import type { AudienceCandidate } from "../../../domain/audience/resolveAudience";
import { normalizeEmail } from "../../../domain/email/normalizeEmail";
import type { SegmentDefinition } from "../../../domain/segment/segmentDefinition";
import {
  CompanyCrmStatus,
  ConsentStatus,
  CrmBoardKind,
  EmailSourceType,
  EmailStatus,
  Language,
} from "../../../domain/types";

import {
  AddressFacts,
  buildCompanyWhere,
  buildContactWhere,
  hasCommunicationConstraint,
  hasCompanyConstraint,
  matchesCommunication,
} from "./segmentQuery";

/**
 * Loads the CRM records a segment selects, as audience candidates.
 *
 * Stage 1 of audience resolution: CRM MATCHING only. Eligibility is applied
 * afterwards by `resolveAudience` — a record can match the segment and still be
 * excluded from delivery, and the two must stay distinguishable (CLAUDE.md).
 *
 * Only two address kinds are ever produced: the company campaign email and the
 * contact email. The accounting address has no code path here (ADR-0009).
 */

/** Chunk size for `IN (...)` lookups, so a large audience stays a bounded query. */
const LOOKUP_CHUNK = 1_000;

export interface SegmentCandidates {
  candidates: AudienceCandidate[];
  /** Local id -> display name, for the "why did this address match" panel. */
  companyNames: Map<string, string>;
  contactNames: Map<string, string>;
  matchedCompanies: number;
  matchedContacts: number;
}

const DEFAULT_FACTS: AddressFacts = {
  language: Language.UNKNOWN,
  consentStatus: ConsentStatus.UNKNOWN,
  emailStatus: EmailStatus.UNKNOWN,
  isUnsubscribed: false,
  isSuppressed: false,
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Communication facts for a set of normalized emails, in bounded queries. */
export async function loadAddressFacts(
  prisma: PrismaClient,
  emails: string[],
): Promise<Map<string, AddressFacts>> {
  const facts = new Map<string, AddressFacts>();
  if (emails.length === 0) return facts;

  const unique = [...new Set(emails)];

  for (const part of chunk(unique, LOOKUP_CHUNK)) {
    const [addresses, unsubscribes, suppressions] = await Promise.all([
      prisma.communicationAddress.findMany({
        where: { normalizedEmail: { in: part } },
        select: {
          normalizedEmail: true,
          language: true,
          consentStatus: true,
          emailStatus: true,
        },
      }),
      prisma.unsubscribe.findMany({
        where: { normalizedEmail: { in: part } },
        select: { normalizedEmail: true },
      }),
      prisma.suppression.findMany({
        where: { normalizedEmail: { in: part } },
        select: { normalizedEmail: true },
      }),
    ]);

    const unsubscribed = new Set(unsubscribes.map((r) => r.normalizedEmail));
    const suppressed = new Set(suppressions.map((r) => r.normalizedEmail));

    for (const address of addresses) {
      facts.set(address.normalizedEmail, {
        language: address.language,
        consentStatus: address.consentStatus,
        emailStatus: address.emailStatus,
        isUnsubscribed: unsubscribed.has(address.normalizedEmail),
        isSuppressed: suppressed.has(address.normalizedEmail),
      });
    }

    // An address with no CommunicationAddress row yet still carries unsubscribe
    // and suppression facts — those are append-only and must never be lost.
    for (const email of part) {
      if (facts.has(email)) continue;
      if (unsubscribed.has(email) || suppressed.has(email)) {
        facts.set(email, {
          ...DEFAULT_FACTS,
          isUnsubscribed: unsubscribed.has(email),
          isSuppressed: suppressed.has(email),
        });
      }
    }
  }

  return facts;
}

export async function resolveSegmentCandidates(
  prisma: PrismaClient,
  definition: SegmentDefinition,
  now: Date = new Date(),
): Promise<SegmentCandidates> {
  const companyWhere = buildCompanyWhere(definition, now);
  const contactWhere = buildContactWhere(definition);
  const companyConstrained = hasCompanyConstraint(definition);

  const candidates: AudienceCandidate[] = [];
  const companyNames = new Map<string, string>();
  const contactNames = new Map<string, string>();
  let matchedCompanies = 0;
  let matchedContacts = 0;

  if (definition.include.companyEmails) {
    const companies = await prisma.company.findMany({
      where: companyWhere,
      select: {
        id: true,
        name: true,
        mondayBoardId: true,
        mondayItemId: true,
        companyEmail: true,
        archivedAt: true,
        customerStatus: true,
      },
    });

    matchedCompanies = companies.length;
    for (const company of companies) {
      if (company.name) companyNames.set(company.id, company.name);
      candidates.push({
        sourceBoardId: company.mondayBoardId,
        sourceItemId: company.mondayItemId,
        sourceEntityType: CrmBoardKind.CUSTOMERS,
        emailSourceType: EmailSourceType.COMPANY_EMAIL,
        rawEmail: company.companyEmail,
        sourceArchived: company.archivedAt !== null,
        companyInactive: company.customerStatus === CompanyCrmStatus.INACTIVE,
        companyId: company.id,
      });
    }
  } else if (companyConstrained) {
    // Company emails are excluded from the audience, but the company filter
    // still has to be counted for the "companies matched" figure.
    matchedCompanies = await prisma.company.count({ where: companyWhere });
  }

  if (definition.include.contactEmails) {
    // A contact belongs to the segment only if it matches the contact
    // conditions AND belongs to a company that matches the company conditions.
    const where =
      companyConstrained && companyWhere
        ? {
            AND: [
              ...(contactWhere ? [contactWhere] : []),
              { companyLinks: { some: { company: companyWhere } } },
            ],
          }
        : contactWhere;

    const contacts = await prisma.contact.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        mondayBoardId: true,
        mondayItemId: true,
        email: true,
        archivedAt: true,
        companyLinks: {
          select: { companyId: true, company: { select: { name: true } } },
          take: 1,
        },
      },
    });

    matchedContacts = contacts.length;
    for (const contact of contacts) {
      if (contact.fullName) contactNames.set(contact.id, contact.fullName);
      const link = contact.companyLinks[0];
      if (link?.company?.name) companyNames.set(link.companyId, link.company.name);
      candidates.push({
        sourceBoardId: contact.mondayBoardId,
        sourceItemId: contact.mondayItemId,
        sourceEntityType: CrmBoardKind.CONTACTS,
        emailSourceType: EmailSourceType.CONTACT_EMAIL,
        rawEmail: contact.email,
        sourceArchived: contact.archivedAt !== null,
        contactId: contact.id,
        companyId: link?.companyId,
      });
    }
  } else if (contactWhere) {
    matchedContacts = await prisma.contact.count({ where: contactWhere });
  }

  // ---- attach communication facts, and apply email-settings conditions -----
  const emails: string[] = [];
  for (const candidate of candidates) {
    const parsed = normalizeEmail(candidate.rawEmail);
    if (parsed.kind === "valid") emails.push(parsed.normalized);
  }

  const facts = await loadAddressFacts(prisma, emails);
  const filterByCommunication = hasCommunicationConstraint(definition);
  const kept: AudienceCandidate[] = [];

  for (const candidate of candidates) {
    const parsed = normalizeEmail(candidate.rawEmail);
    const profile = parsed.kind === "valid" ? facts.get(parsed.normalized) : undefined;

    if (filterByCommunication) {
      // Without a usable address there are no email settings to match on, so the
      // record is simply not in the segment — this is matching, not exclusion.
      if (parsed.kind !== "valid") continue;
      if (!matchesCommunication(definition, profile ?? DEFAULT_FACTS)) continue;
    }

    kept.push({
      ...candidate,
      address: profile
        ? {
            emailStatus: profile.emailStatus as EmailStatus,
            language: profile.language as Language,
            consentStatus: profile.consentStatus as ConsentStatus,
            isUnsubscribed: profile.isUnsubscribed,
            isSuppressed: profile.isSuppressed,
          }
        : undefined,
    });
  }

  // Report what actually survived the email-settings conditions. Counting the
  // rows the CRM query returned would claim "1,215 companies matched" for a
  // segment that ends up selecting nobody — technically true, but misleading.
  if (filterByCommunication) {
    const seenCompanies = new Set<string>();
    const seenContacts = new Set<string>();
    for (const candidate of kept) {
      const key = `${candidate.sourceBoardId}|${candidate.sourceItemId}`;
      if (candidate.emailSourceType === EmailSourceType.COMPANY_EMAIL) {
        seenCompanies.add(key);
      } else {
        seenContacts.add(key);
      }
    }
    matchedCompanies = seenCompanies.size;
    matchedContacts = seenContacts.size;
  }

  return {
    candidates: kept,
    companyNames,
    contactNames,
    matchedCompanies,
    matchedContacts,
  };
}
