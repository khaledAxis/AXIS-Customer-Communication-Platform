import "server-only";

import { validateSourceUrl } from "../../domain/content/sourceUrl";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";

/**
 * Managing approved content sources (ADR-0026).
 *
 * A source is a URL this server will later fetch, so creating one is an
 * infrastructure act, not an editorial one: `MANAGE_CONTENT_SOURCES` is ADMIN-only,
 * enforced here rather than by hiding a button.
 *
 * The URL is validated on the way IN, and validated again inside the fetcher on the
 * way OUT. That is not redundant: a row stored a month ago is untrusted input today,
 * DNS changes under a hostname that once looked fine, and the second check is the one
 * that sees redirects.
 *
 * There is deliberately NO crawl configuration — no depth, no follow-links, no
 * link-discovery toggle. This platform reads a declared feed and nothing else, and
 * the absence of those options is what keeps it from becoming a web crawler.
 */

export type SourceKind = "RSS" | "ATOM" | "MANUAL_EXTERNAL";

export interface SourceInput {
  name: string;
  kind: string;
  /** Human-facing site, display only — never fetched. */
  baseUrl?: string | null;
  /** The feed that IS fetched. Required for RSS/ATOM. */
  feedUrl?: string | null;
  language?: string | null;
  /** Comma-separated in the form; stored as a list. */
  categories?: string | null;
  isEnabled?: boolean;
}

export interface FieldError {
  field: string;
  message: string;
}

export type SourceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

const FETCHED_KINDS: SourceKind[] = ["RSS", "ATOM"];

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function parseCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part !== "")
        .slice(0, 12),
    ),
  );
}

/** Validates the shape a person typed. The URL rules live in `domain/content`. */
export function validateSourceInput(input: SourceInput): SourceResult<{
  name: string;
  kind: SourceKind;
  baseUrl: string | null;
  feedUrl: string | null;
  language: "HE" | "AR" | "UNKNOWN";
  categories: string[];
}> {
  const errors: FieldError[] = [];

  const name = normalize(input.name);
  if (!name) errors.push({ field: "name", message: "Give this source a name." });
  else if (name.length > 120) {
    errors.push({ field: "name", message: "That name is too long." });
  }

  const kind = input.kind as SourceKind;
  if (!["RSS", "ATOM", "MANUAL_EXTERNAL"].includes(kind)) {
    errors.push({ field: "kind", message: "Choose what kind of source this is." });
  }

  const feedUrl = normalize(input.feedUrl);
  if (FETCHED_KINDS.includes(kind)) {
    const validated = validateSourceUrl(feedUrl);
    if (!validated.ok) errors.push({ field: "feedUrl", message: validated.message });
  } else if (feedUrl) {
    // A manual source carries no feed. Refuse rather than silently ignore it, so
    // nobody believes a URL they typed is being polled.
    errors.push({
      field: "feedUrl",
      message:
        "A manual source is not fetched automatically, so it has no feed address. Leave it blank.",
    });
  }

  const baseUrl = normalize(input.baseUrl);
  if (baseUrl) {
    const validated = validateSourceUrl(baseUrl);
    if (!validated.ok) errors.push({ field: "baseUrl", message: validated.message });
  }

  const language = (input.language ?? "UNKNOWN") as "HE" | "AR" | "UNKNOWN";
  if (!["HE", "AR", "UNKNOWN"].includes(language)) {
    errors.push({ field: "language", message: "Choose a language, or leave it unknown." });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: name as string,
      kind,
      baseUrl,
      feedUrl: FETCHED_KINDS.includes(kind) ? feedUrl : null,
      language,
      categories: parseCategories(input.categories),
    },
  };
}

export async function listSources() {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();
  const sources = await prisma.contentSource.findMany({
    where: { kind: { not: "INTERNAL" } },
    orderBy: [{ isEnabled: "desc" }, { name: "asc" }],
    include: {
      createdBy: { select: { email: true, name: true } },
      _count: { select: { items: true } },
      ingestionRuns: {
        orderBy: [{ startedAt: "desc" }],
        take: 1,
        select: {
          status: true,
          startedAt: true,
          createdCount: true,
          discoveredCount: true,
          errorMessage: true,
        },
      },
    },
  });
  return sources;
}

export async function getSource(id: string) {
  await requireCapability(Capability.MANAGE_CONTENT);
  return getPrisma().contentSource.findUnique({
    where: { id },
    include: {
      ingestionRuns: { orderBy: [{ startedAt: "desc" }], take: 20 },
      _count: { select: { items: true } },
    },
  });
}

export async function createSource(input: SourceInput): Promise<SourceResult<{ id: string }>> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT_SOURCES);
  const validated = validateSourceInput(input);
  if (!validated.ok) return validated;

  const prisma = getPrisma();
  const source = await prisma.$transaction(async (tx) => {
    const created = await tx.contentSource.create({
      data: {
        name: validated.data.name,
        kind: validated.data.kind,
        baseUrl: validated.data.baseUrl,
        feedUrl: validated.data.feedUrl,
        language: validated.data.language,
        categories: validated.data.categories,
        isEnabled: input.isEnabled !== false,
        createdById: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "CONTENT_SOURCE_CREATED",
        actorUserId: actor.id,
        entityType: "ContentSource",
        entityId: created.id,
        toState: created.isEnabled ? "ENABLED" : "DISABLED",
        // The URL is recorded on purpose: which addresses this server was told to
        // fetch, and by whom, is exactly what an auditor would want to know.
        metadata: {
          name: created.name,
          kind: created.kind,
          feedUrl: created.feedUrl,
        },
      },
    });

    return created;
  });

  return { ok: true, data: { id: source.id } };
}

export async function updateSource(
  id: string,
  input: SourceInput,
): Promise<SourceResult<{ id: string }>> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT_SOURCES);
  const validated = validateSourceInput(input);
  if (!validated.ok) return validated;

  const prisma = getPrisma();
  const existing = await prisma.contentSource.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That source no longer exists." }] };
  }

  await prisma.$transaction(async (tx) => {
    await tx.contentSource.update({
      where: { id },
      data: {
        name: validated.data.name,
        kind: validated.data.kind,
        baseUrl: validated.data.baseUrl,
        feedUrl: validated.data.feedUrl,
        language: validated.data.language,
        categories: validated.data.categories,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "CONTENT_SOURCE_UPDATED",
        actorUserId: actor.id,
        entityType: "ContentSource",
        entityId: id,
        fromState: existing.feedUrl,
        toState: validated.data.feedUrl,
        metadata: { name: validated.data.name, kind: validated.data.kind },
      },
    });
  });

  return { ok: true, data: { id } };
}

/**
 * Enables or disables a source.
 *
 * Disabling is the reversible, non-destructive control, and it is the one staff should
 * reach for: a source is never deleted while its articles exist, because a sent
 * newsletter still points at them.
 */
export async function setSourceEnabled(
  id: string,
  isEnabled: boolean,
): Promise<SourceResult<{ id: string; isEnabled: boolean }>> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT_SOURCES);
  const prisma = getPrisma();

  const existing = await prisma.contentSource.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, errors: [{ field: "id", message: "That source no longer exists." }] };
  }

  await prisma.$transaction(async (tx) => {
    await tx.contentSource.update({ where: { id }, data: { isEnabled } });
    await tx.auditLog.create({
      data: {
        action: isEnabled ? "CONTENT_SOURCE_ENABLED" : "CONTENT_SOURCE_DISABLED",
        actorUserId: actor.id,
        entityType: "ContentSource",
        entityId: id,
        fromState: existing.isEnabled ? "ENABLED" : "DISABLED",
        toState: isEnabled ? "ENABLED" : "DISABLED",
        metadata: { name: existing.name },
      },
    });
  });

  return { ok: true, data: { id, isEnabled } };
}

/**
 * The sources ingestion is permitted to read.
 *
 * The ONLY way the ingestion service obtains a URL. It cannot be handed one, and there
 * is no code path from a form field or a feed's contents to a fetch.
 */
export async function listFetchableSources(ids?: string[]) {
  const prisma = getPrisma();
  return prisma.contentSource.findMany({
    where: {
      isEnabled: true,
      kind: { in: ["RSS", "ATOM"] },
      feedUrl: { not: null },
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    orderBy: [{ name: "asc" }],
  });
}
