import type { Prisma } from "@prisma/client";

import {
  AudienceCandidate,
  AudienceResult,
  AudienceSnapshot,
  ExclusionRecord,
  resolveAudience,
} from "../../domain/audience/resolveAudience";
import {
  SegmentDefinition,
  SegmentDefinitionError,
  emptySegmentDefinition,
  parseSegmentDefinition,
} from "../../domain/segment/segmentDefinition";
import { EmailSourceType, ExclusionReason, Language } from "../../domain/types";

import { Capability, requireCapability } from "../auth/session";
import {
  resolveSegmentCandidates,
} from "../db/repositories/audienceRepository";
import { getPrisma } from "../db/prisma";

/**
 * Segment use-cases: definition CRUD plus audience preview.
 *
 * A preview is ANALYSIS ONLY. It resolves the audience and reports counts; it
 * creates no `CampaignRecipient`, writes no `CampaignEvent`, and sends nothing.
 * The only rows a preview can write are the explicitly-requested campaign
 * audience snapshot (see `snapshotCampaignAudience`).
 */

export const PREVIEW_SAMPLE_LIMIT = 200;
export const EXCLUSION_LIST_LIMIT = 500;

export interface SegmentSummary {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: Date;
  campaignCount: number;
  /** Set when the stored rules no longer parse (e.g. hand-edited JSON). */
  problem: string | null;
  conditionCount: number;
}

export interface DestinationPreview {
  normalizedEmail: string;
  sources: {
    kind: EmailSourceType;
    /** Friendly "ABC Surveying" / "John Doe", never a database id. */
    label: string;
    rawEmail: string;
  }[];
}

export interface ExclusionPreview {
  normalizedEmail: string | null;
  rawEmail: string | null;
  reason: ExclusionReason;
  kind: EmailSourceType;
  label: string;
}

export interface AudiencePreview {
  resolvedAt: Date;
  requireLanguage: Language | null;
  matchedCompanies: number;
  matchedContacts: number;
  snapshot: AudienceSnapshot;
  /** Capped sample for the UI; counts above are complete. */
  destinations: DestinationPreview[];
  destinationsTruncated: boolean;
  exclusions: ExclusionPreview[];
  exclusionsTruncated: boolean;
  /**
   * Every exclusion with its CRM provenance, present only when the caller asked
   * for it (the audience snapshot needs them; the UI does not).
   */
  allExclusions?: ExclusionRecord[];
}

function definitionOf(criteria: Prisma.JsonValue): SegmentDefinition {
  return parseSegmentDefinition(criteria);
}

function conditionCount(definition: SegmentDefinition): number {
  return (
    definition.conditions.length +
    definition.groups.reduce((sum, g) => sum + g.conditions.length, 0)
  );
}

export async function listSegments(): Promise<SegmentSummary[]> {
  const rows = await getPrisma().segment.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { _count: { select: { campaigns: true } } },
  });

  return rows.map((row) => {
    let problem: string | null = null;
    let conditions = 0;
    try {
      conditions = conditionCount(definitionOf(row.criteria));
    } catch (error) {
      problem =
        error instanceof SegmentDefinitionError
          ? error.issues[0]?.message ?? "These rules could not be read."
          : "These rules could not be read.";
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
      campaignCount: row._count.campaigns,
      problem,
      conditionCount: conditions,
    };
  });
}

export interface SegmentDetail {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: Date;
  definition: SegmentDefinition;
  /** Non-null when the stored rules failed validation and were reset for display. */
  problem: string | null;
  campaigns: { id: string; name: string; status: string }[];
}

export async function getSegment(id: string): Promise<SegmentDetail | null> {
  const row = await getPrisma().segment.findUnique({
    where: { id },
    include: {
      campaigns: {
        select: { id: true, name: true, status: true },
        orderBy: [{ updatedAt: "desc" }],
      },
    },
  });
  if (!row) return null;

  let definition = emptySegmentDefinition();
  let problem: string | null = null;
  try {
    definition = definitionOf(row.criteria);
  } catch (error) {
    problem =
      error instanceof SegmentDefinitionError
        ? error.issues.map((i) => i.message).join(" ")
        : "These rules could not be read.";
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
    definition,
    problem,
    campaigns: row.campaigns,
  };
}

export interface SegmentInput {
  name: string;
  description?: string | null;
  definition: unknown;
}

/** Validates before writing: a segment row can never hold rules we cannot run. */
function validatedCriteria(input: unknown): Prisma.InputJsonValue {
  const definition = parseSegmentDefinition(input);
  return definition as unknown as Prisma.InputJsonValue;
}

export async function createSegment(input: SegmentInput): Promise<string> {
  await requireCapability(Capability.MANAGE_SEGMENTS);
  const name = input.name.trim();
  if (name === "") {
    throw new SegmentDefinitionError([
      { path: "name", message: "Give this segment a name." },
    ]);
  }
  const criteria = validatedCriteria(input.definition);
  const row = await getPrisma().segment.create({
    data: {
      name,
      description: input.description?.trim() || null,
      criteria,
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateSegment(
  id: string,
  input: SegmentInput,
): Promise<void> {
  await requireCapability(Capability.MANAGE_SEGMENTS);
  const name = input.name.trim();
  if (name === "") {
    throw new SegmentDefinitionError([
      { path: "name", message: "Give this segment a name." },
    ]);
  }
  const criteria = validatedCriteria(input.definition);
  await getPrisma().segment.update({
    where: { id },
    data: {
      name,
      description: input.description?.trim() || null,
      criteria,
    },
  });
}

export async function duplicateSegment(id: string): Promise<string> {
  await requireCapability(Capability.MANAGE_SEGMENTS);
  const prisma = getPrisma();
  const row = await prisma.segment.findUnique({ where: { id } });
  if (!row) throw new Error("Segment not found");

  const copy = await prisma.segment.create({
    data: {
      name: `${row.name} (copy)`,
      description: row.description,
      criteria: row.criteria as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return copy.id;
}

export class SegmentInUseError extends Error {
  constructor(public readonly campaignCount: number) {
    super("This segment is used by a newsletter.");
    this.name = "SegmentInUseError";
  }
}

/**
 * Deletes a segment only when nothing references it. A segment attached to a
 * campaign is part of that campaign's audit trail.
 */
export async function deleteSegment(id: string): Promise<void> {
  await requireCapability(Capability.MANAGE_SEGMENTS);
  const prisma = getPrisma();
  const [campaigns, automations] = await Promise.all([
    prisma.campaign.count({ where: { segmentId: id } }),
    prisma.newsletterAutomation.count({ where: { segmentId: id } }),
  ]);
  if (campaigns + automations > 0) {
    throw new SegmentInUseError(campaigns + automations);
  }
  await prisma.segment.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Lookup lists for the builder
// ---------------------------------------------------------------------------

export interface LookupOptions {
  classifications: { value: string; label: string; count: number }[];
  industries: { value: string; label: string; count: number }[];
  productTypes: { value: string; label: string; count: number }[];
}

export async function getLookupOptions(): Promise<LookupOptions> {
  const prisma = getPrisma();
  const [classifications, industries, productTypes] = await Promise.all([
    prisma.customerClassification.findMany({
      select: { label: true, _count: { select: { companies: true } } },
      orderBy: [{ label: "asc" }],
    }),
    prisma.industry.findMany({
      select: { label: true, _count: { select: { companies: true } } },
      orderBy: [{ label: "asc" }],
    }),
    prisma.product.groupBy({
      by: ["itemType"],
      _count: { _all: true },
      orderBy: [{ itemType: "asc" }],
    }),
  ]);

  return {
    classifications: classifications.map((c) => ({
      value: c.label,
      label: c.label,
      count: c._count.companies,
    })),
    industries: industries.map((i) => ({
      value: i.label,
      label: i.label,
      count: i._count.companies,
    })),
    productTypes: productTypes
      .filter((p): p is typeof p & { itemType: string } => Boolean(p.itemType))
      .map((p) => ({
        value: p.itemType,
        label: p.itemType,
        count: p._count._all,
      })),
  };
}

// ---------------------------------------------------------------------------
// Audience preview
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  /** Localized campaign language. Addresses in another (or no) language are excluded. */
  requireLanguage?: Language | null;
  now?: Date;
  /** Include the full exclusion list with provenance, for snapshotting. */
  includeAllExclusions?: boolean;
  /** Require an explicitly GRANTED consent (ADR-0021). Off by default. */
  requireExplicitConsent?: boolean;
}

/** Everything one audience resolution produced, before it is shaped for a caller. */
export interface ResolvedAudience {
  resolvedAt: Date;
  requireLanguage: Language | null;
  requireExplicitConsent: boolean;
  matchedCompanies: number;
  matchedContacts: number;
  candidates: AudienceCandidate[];
  result: AudienceResult;
  /** Friendly CRM name for a source — never a database id. */
  labelFor: (source: {
    emailSourceType: EmailSourceType;
    companyId?: string;
    contactId?: string;
  }) => string;
  /** Company name behind a contact source, for the audience inspector. */
  companyNameFor: (companyId: string | undefined) => string | null;
}

/**
 * THE audience resolution. Every caller — the preview panel, the draft snapshot and
 * the frozen final audience — goes through this one function, so there is exactly one
 * eligibility engine and one deduplication rule (CLAUDE.md).
 *
 * Writes nothing, sends nothing, and is unaware of TEST/PRODUCTION mode.
 */
export async function resolveAudienceForDefinition(
  rawDefinition: unknown,
  options: PreviewOptions = {},
): Promise<ResolvedAudience> {
  const definition = parseSegmentDefinition(rawDefinition);
  const now = options.now ?? new Date();
  const requireLanguage = options.requireLanguage ?? null;
  const requireExplicitConsent = options.requireExplicitConsent === true;

  const { candidates, companyNames, contactNames, matchedCompanies, matchedContacts } =
    await resolveSegmentCandidates(getPrisma(), definition, now);

  const result = resolveAudience(candidates, {
    requireLanguage: requireLanguage ?? undefined,
    requireExplicitConsent,
  });

  const labelFor = (source: {
    emailSourceType: EmailSourceType;
    companyId?: string;
    contactId?: string;
  }): string => {
    if (source.emailSourceType === EmailSourceType.CONTACT_EMAIL) {
      const name = source.contactId ? contactNames.get(source.contactId) : undefined;
      return name ?? "Contact without a name";
    }
    const name = source.companyId ? companyNames.get(source.companyId) : undefined;
    return name ?? "Company without a name";
  };

  const companyNameFor = (companyId: string | undefined): string | null =>
    companyId ? companyNames.get(companyId) ?? null : null;

  return {
    resolvedAt: now,
    requireLanguage,
    requireExplicitConsent,
    matchedCompanies,
    matchedContacts,
    candidates,
    result,
    labelFor,
    companyNameFor,
  };
}

/**
 * Resolves the audience for a definition and reports what would happen.
 *
 * Writes nothing. The `resolveAudience` domain function does the eligibility and
 * deduplication work — this service only loads candidates and shapes the result
 * for the UI, so preview and a future send share one code path.
 */
export async function previewAudience(
  rawDefinition: unknown,
  options: PreviewOptions = {},
): Promise<AudiencePreview> {
  const resolved = await resolveAudienceForDefinition(rawDefinition, options);
  const { result, candidates, labelFor } = resolved;

  const destinations: DestinationPreview[] = result.recipients
    .slice(0, PREVIEW_SAMPLE_LIMIT)
    .map((recipient) => ({
      normalizedEmail: recipient.normalizedEmail,
      sources: recipient.sources.map((source) => ({
        kind: source.emailSourceType,
        label: labelFor(source),
        rawEmail: source.sourceEmailRaw,
      })),
    }));

  // Exclusions carry no local ids, so they are labelled from the candidate list.
  const byIdentity = new Map(
    candidates.map((c) => [`${c.sourceBoardId}|${c.sourceItemId}|${c.emailSourceType}`, c]),
  );

  const exclusions: ExclusionPreview[] = result.exclusions
    .slice(0, EXCLUSION_LIST_LIMIT)
    .map((exclusion) => {
      const candidate = byIdentity.get(
        `${exclusion.sourceBoardId}|${exclusion.sourceItemId}|${exclusion.emailSourceType}`,
      );
      return {
        normalizedEmail: exclusion.normalizedEmail ?? null,
        rawEmail: exclusion.sourceEmailRaw,
        reason: exclusion.reason,
        kind: exclusion.emailSourceType,
        label: candidate
          ? labelFor(candidate)
          : exclusion.emailSourceType === EmailSourceType.CONTACT_EMAIL
            ? "Contact"
            : "Company",
      };
    });

  return {
    resolvedAt: resolved.resolvedAt,
    requireLanguage: resolved.requireLanguage,
    matchedCompanies: resolved.matchedCompanies,
    matchedContacts: resolved.matchedContacts,
    snapshot: result.snapshot,
    destinations,
    destinationsTruncated: result.recipients.length > PREVIEW_SAMPLE_LIMIT,
    exclusions,
    exclusionsTruncated: result.exclusions.length > EXCLUSION_LIST_LIMIT,
    allExclusions: options.includeAllExclusions ? result.exclusions : undefined,
  };
}

/** Preview for a saved segment, re-reading its rules (dynamic membership). */
export async function previewSegment(
  segmentId: string,
  options: PreviewOptions = {},
): Promise<AudiencePreview | null> {
  const row = await getPrisma().segment.findUnique({
    where: { id: segmentId },
    select: { criteria: true },
  });
  if (!row) return null;
  return previewAudience(row.criteria, options);
}
