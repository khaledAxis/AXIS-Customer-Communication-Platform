import "server-only";

import { randomUUID } from "node:crypto";

import { parseFeed, type ParsedFeedItem } from "../../domain/content/feedParser";
import { validateSourceUrl } from "../../domain/content/sourceUrl";
import { articleIdentity, isIdentifiable } from "../../domain/content/urlIdentity";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { getFeedFetcher } from "../integrations/content/feedFetcher";
import { listFetchableSources } from "./contentSourceService";

/**
 * Collecting articles from approved sources (ADR-0026).
 *
 * Three properties this service exists to guarantee:
 *
 * 1. **Nothing collected is usable.** Every ingested item is created
 *    `PENDING_REVIEW`. There is no branch, flag or configuration that creates one
 *    APPROVED, so no automation can put an unreviewed article in front of a customer.
 * 2. **Re-running is free.** Identity is `(source, externalId)` or
 *    `(source, normalizedUrl)`, both UNIQUE in the database. Polling the same feed
 *    hourly for a year yields one row per article, and the guarantee is the index —
 *    not a check that could race with a concurrent run.
 * 3. **One bad source is one bad line.** Each source is fetched, parsed and committed
 *    independently. A timeout on one produces `FAILED` for that source and `PARTIAL`
 *    for the batch; the others still land.
 *
 * It stores a title, a link, a short SOURCE-SUPPLIED excerpt and metadata — never the
 * article body. AXIS links to the publisher; it does not republish them.
 */

export interface SourceRunSummary {
  sourceId: string;
  sourceName: string;
  status: "SUCCESS" | "FAILED";
  discovered: number;
  created: number;
  duplicates: number;
  skipped: number;
  /** Friendly text. Never a stack trace, never an internal address. */
  message: string | null;
}

export interface IngestionBatchResult {
  batchId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "NO_SOURCES";
  sources: SourceRunSummary[];
  totalCreated: number;
  totalDiscovered: number;
  /** Plain-language summary for the screen. */
  message: string;
}

/** Guards against a feed whose every entry is new — a mis-configured source. */
const MAX_NEW_ITEMS_PER_SOURCE = 50;

function toContentItemData(
  item: ParsedFeedItem,
  source: { id: string; name: string; language: string },
) {
  const identity = articleIdentity({
    externalId: item.externalId,
    canonicalUrl: item.link,
    externalUrl: item.link,
  });

  return {
    title: item.title.slice(0, 300),
    // The SOURCE's excerpt, as supplied and already truncated by the parser. AXIS
    // editorial copy lives in separate columns and is never written here.
    summary: item.summary,
    // Never inferred from the article text — the source's declared language, or
    // UNKNOWN, exactly as with communication language (ADR-0020).
    language: source.language as "HE" | "AR" | "UNKNOWN",
    origin: "INGESTED" as const,
    // The invariant: collected is not usable. A human decides.
    reviewState: "PENDING_REVIEW" as const,
    sourceId: source.id,
    sourceName: source.name,
    author: item.author,
    externalId: identity.externalId,
    externalUrl: item.link,
    canonicalUrl: item.link,
    normalizedUrl: identity.normalizedUrl,
    // NOT imported into Cloudinary here. The URL is recorded so a reviewer can see
    // the thumbnail; importing an asset is a separate, deliberate human action.
    imageUrl: null,
    publishedAt: item.publishedAt,
    ingestedAt: new Date(),
  };
}

/** Fetches and stores one source. Never throws — a failure is a returned summary. */
async function ingestOne(
  source: { id: string; name: string; feedUrl: string | null; language: string },
  batchId: string,
  actorId: string | null,
): Promise<SourceRunSummary> {
  const prisma = getPrisma();
  const base = {
    sourceId: source.id,
    sourceName: source.name,
    discovered: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
  };

  const run = await prisma.contentIngestionRun.create({
    data: {
      sourceId: source.id,
      status: "RUNNING",
      batchId,
      triggeredById: actorId,
    },
  });

  const finish = async (
    status: "SUCCESS" | "FAILED",
    counts: { discovered: number; created: number; duplicates: number; errors: number },
    message: string | null,
  ) => {
    await prisma.$transaction([
      prisma.contentIngestionRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          discoveredCount: counts.discovered,
          createdCount: counts.created,
          duplicateCount: counts.duplicates,
          errorCount: counts.errors,
          errorMessage: message,
        },
      }),
      prisma.contentSource.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: new Date(),
          // Only a success moves this, so "polled but broken for a week" is visible.
          ...(status === "SUCCESS"
            ? { lastSucceededAt: new Date(), lastErrorMessage: null }
            : { lastErrorMessage: message }),
        },
      }),
    ]);
  };

  // Re-validated here even though it was validated when stored: a row is untrusted
  // input, and this is the last check before a network call.
  const validated = validateSourceUrl(source.feedUrl);
  if (!validated.ok) {
    await finish("FAILED", { discovered: 0, created: 0, duplicates: 0, errors: 1 }, validated.message);
    return { ...base, status: "FAILED", message: validated.message };
  }

  const fetched = await getFeedFetcher()(validated.url);
  if (!fetched.ok) {
    await finish("FAILED", { discovered: 0, created: 0, duplicates: 0, errors: 1 }, fetched.message);
    return { ...base, status: "FAILED", message: fetched.message };
  }

  const parsed = parseFeed(fetched.body);
  if (!parsed.ok) {
    await finish("FAILED", { discovered: 0, created: 0, duplicates: 0, errors: 1 }, parsed.message);
    return { ...base, status: "FAILED", message: parsed.message };
  }

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const discovered = parsed.feed.items.length;

  for (const item of parsed.feed.items) {
    if (created >= MAX_NEW_ITEMS_PER_SOURCE) {
      skipped += 1;
      continue;
    }

    const data = toContentItemData(item, source);
    const identity = { externalId: data.externalId, normalizedUrl: data.normalizedUrl };

    // An article this platform cannot identify cannot be deduplicated, so re-polling
    // would create a copy every hour. Skipped rather than stored.
    if (!isIdentifiable(identity)) {
      skipped += 1;
      continue;
    }

    // The link must itself be a public http(s) URL — a feed is untrusted input, and a
    // `javascript:` or `file:` link must never reach a newsletter or a reviewer's click.
    if (data.externalUrl && !validateSourceUrl(data.externalUrl).ok) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.contentItem.findFirst({
      where: {
        sourceId: source.id,
        OR: [
          ...(identity.externalId ? [{ externalId: identity.externalId }] : []),
          ...(identity.normalizedUrl ? [{ normalizedUrl: identity.normalizedUrl }] : []),
        ],
      },
      select: { id: true },
    });

    if (existing) {
      duplicates += 1;
      continue;
    }

    try {
      await prisma.contentItem.create({ data });
      created += 1;
    } catch {
      // Lost a race against a concurrent run: the UNIQUE index did its job. That is a
      // duplicate, not an error — the row exists, which is what was wanted.
      duplicates += 1;
    }
  }

  await finish("SUCCESS", { discovered, created, duplicates, errors: 0 }, null);
  return { ...base, status: "SUCCESS", discovered, created, duplicates, skipped, message: null };
}

/**
 * Checks every enabled feed source, or a named subset.
 *
 * MANAGER may run this: reading approved sources is editorial work. Only an ADMIN can
 * decide WHICH sources exist, which is where the network risk actually lives.
 */
export async function runIngestion(options?: {
  sourceIds?: string[];
}): Promise<IngestionBatchResult> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  const batchId = randomUUID();

  const sources = await listFetchableSources(options?.sourceIds);
  if (sources.length === 0) {
    return {
      batchId,
      status: "NO_SOURCES",
      sources: [],
      totalCreated: 0,
      totalDiscovered: 0,
      message:
        "There are no enabled feed sources to check yet. An administrator can add one under Sources.",
    };
  }

  const summaries: SourceRunSummary[] = [];
  for (const source of sources) {
    // Sequential on purpose: a handful of sources at AXIS's scale, and one source at a
    // time is far friendlier to the publishers being polled than a burst.
    summaries.push(
      await ingestOne(
        {
          id: source.id,
          name: source.name,
          feedUrl: source.feedUrl,
          language: source.language,
        },
        batchId,
        actor.id,
      ),
    );
  }

  const failed = summaries.filter((summary) => summary.status === "FAILED").length;
  const totalCreated = summaries.reduce((sum, summary) => sum + summary.created, 0);
  const totalDiscovered = summaries.reduce((sum, summary) => sum + summary.discovered, 0);

  const status =
    failed === 0 ? "SUCCESS" : failed === summaries.length ? "FAILED" : "PARTIAL";

  await getPrisma().auditLog.create({
    data: {
      action: "CONTENT_INGESTION_RUN",
      actorUserId: actor.id,
      entityType: "ContentIngestionRun",
      entityId: batchId,
      toState: status,
      metadata: {
        batchId,
        sourcesChecked: summaries.length,
        sourcesFailed: failed,
        created: totalCreated,
        discovered: totalDiscovered,
      },
    },
  });

  return {
    batchId,
    status,
    sources: summaries,
    totalCreated,
    totalDiscovered,
    message:
      totalCreated === 0 && failed === 0
        ? // Explicitly NOT an error. Nothing new is the normal answer most of the time.
          "Everything is up to date — no new articles were published since the last check."
        : status === "PARTIAL"
          ? `${totalCreated} new article${totalCreated === 1 ? "" : "s"} added. ${failed} source${failed === 1 ? "" : "s"} could not be checked.`
          : status === "FAILED"
            ? "No sources could be checked. See the details below."
            : `${totalCreated} new article${totalCreated === 1 ? "" : "s"} added for review.`,
  };
}

/** Recent per-source runs, newest first, for the sources screen. */
export async function listRecentRuns(limit = 25) {
  await requireCapability(Capability.MANAGE_CONTENT);
  return getPrisma().contentIngestionRun.findMany({
    orderBy: [{ startedAt: "desc" }],
    take: limit,
    include: { source: { select: { name: true } } },
  });
}
