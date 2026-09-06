import {
  validateContentDraft,
  type ContentDraftInput,
  type FieldError,
} from "../../domain/content/contentValidation";
import { renderRichText, richTextToPlain } from "../../domain/content/richText";
import { articlePlainText, MAX_ARTICLE_INPUT, normalizeArticleSource, presentArticle } from "../../domain/content/articleFormat";
import { Capability, requireCapability } from "../auth/session";
import * as repo from "../db/repositories/contentRepository";

/**
 * Content use-cases (application layer).
 *
 * Every write validates server-side FIRST, then persists. Body HTML is always
 * generated here by the canonical renderer — client-supplied HTML is never stored,
 * which is what makes the email output XSS-safe by construction.
 */

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

function fail(errors: FieldError[]): { ok: false; errors: FieldError[] } {
  return { ok: false, errors };
}

/** Language drives RTL list padding in the rendered body. */
function directionFor(language: string): "ltr" | "rtl" {
  return language === "HE" || language === "AR" ? "rtl" : "ltr";
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

export interface SaveContentInput extends ContentDraftInput {
  /** Raw editor source (restricted markup) — rendered here, never trusted as HTML. */
  body?: string | null;
  sourceId?: string | null;
}

function prepareContentInput(input: SaveContentInput) {
  const body = normalizeArticleSource(input.body, input.externalUrl);
  return { truncated: body.truncated,
    value: { ...input, title: articlePlainText(input.title), summary: articlePlainText(input.summary), body: body.source } };
}

function inputTooLarge(input: SaveContentInput): boolean {
  return [input.title, input.summary, input.body].some(value => (value?.length ?? 0) > MAX_ARTICLE_INPUT);
}

export async function createContent(input: SaveContentInput) {
  await requireCapability(Capability.MANAGE_CONTENT);
  if (inputTooLarge(input)) return fail([{ field: "body", message: "That article is too large. Import up to 200 KB of text at a time." }]);
  const prepared = prepareContentInput(input);
  if (prepared.truncated) return fail([{ field: "body", message: "This article is too complex to adapt in full. Paste a smaller section before saving." }]);
  input = prepared.value;
  const validation = validateContentDraft(input);
  if (!validation.ok) return fail(validation.errors);

  const language = input.language;
  const body = normalizeOptional(input.body);
  const origin = input.origin === "INGESTED" ? "INGESTED" : "INTERNAL";

  const item = await repo.createContentItem({
    title: input.title.trim(),
    summary: normalizeOptional(articlePlainText(input.summary)),
    language: language as "HE" | "AR" | "UNKNOWN",
    origin,
    // Our own content starts usable; external content must be reviewed (ADR-0010).
    reviewState: origin === "INGESTED" ? "PENDING_REVIEW" : "NEW",
    bodyHtml: body ? renderRichText(body, directionFor(language)) : null,
    bodyText: body,
    imageUrl: normalizeOptional(input.imageUrl),
    imageAlt: normalizeOptional(input.imageAlt),
    externalUrl: normalizeOptional(input.externalUrl),
    author: normalizeOptional(input.author),
    sourceName: normalizeOptional(input.sourceName),
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
    ...(input.sourceId ? { source: { connect: { id: input.sourceId } } } : {}),
  });

  return { ok: true as const, data: item };
}

export async function updateContent(id: string, input: SaveContentInput) {
  await requireCapability(Capability.MANAGE_CONTENT);
  if (inputTooLarge(input)) return fail([{ field: "body", message: "That article is too large. Import up to 200 KB of text at a time." }]);
  const prepared = prepareContentInput(input);
  if (prepared.truncated) return fail([{ field: "body", message: "This article is too complex to adapt in full. Paste a smaller section before saving." }]);
  input = prepared.value;
  const validation = validateContentDraft(input);
  if (!validation.ok) return fail(validation.errors);

  const existing = await repo.getContentItem(id);
  if (!existing) {
    return fail([{ field: "id", message: "That article no longer exists." }]);
  }

  const language = input.language;
  const body = normalizeOptional(input.body);

  const item = await repo.updateContentItem(id, {
    title: input.title.trim(),
    summary: normalizeOptional(articlePlainText(input.summary)),
    language: language as "HE" | "AR" | "UNKNOWN",
    bodyHtml: body ? renderRichText(body, directionFor(language)) : null,
    bodyText: body,
    imageUrl: normalizeOptional(input.imageUrl),
    imageAlt: normalizeOptional(input.imageAlt),
    externalUrl: normalizeOptional(input.externalUrl),
    author: normalizeOptional(input.author),
    sourceName: normalizeOptional(input.sourceName),
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
  });

  return { ok: true as const, data: item };
}

/**
 * Approve / reject. Editing a ContentItem never rewrites already-sent history —
 * campaign snapshots are frozen copies (ADR-0010).
 */
export async function setReviewState(id: string, reviewState: "APPROVED" | "REJECTED" | "PENDING_REVIEW") {
  await requireCapability(Capability.MANAGE_CONTENT);
  const existing = await repo.getContentItem(id);
  if (!existing) return fail([{ field: "id", message: "That article no longer exists." }]);

  const item = await repo.updateContentItem(id, { reviewState });
  return { ok: true as const, data: item };
}

export async function deleteContent(id: string) {
  await requireCapability(Capability.MANAGE_CONTENT);
  if (await repo.countTranslationUsages(id)) return fail([{ field: "id", message: "This original article has translation history, so it must be kept." }]);
  const usages = await repo.countCampaignUsages(id);
  if (usages > 0) {
    return fail([
      {
        field: "id",
        message:
          "This article is used by a newsletter, so it can't be deleted. Remove it from the newsletter first.",
      },
    ]);
  }
  await repo.deleteContentItem(id);
  return { ok: true as const, data: { id } };
}

export async function listContent(...args: Parameters<typeof repo.listContentItems>) {
  return (await repo.listContentItems(...args)).map(presentArticle);
}
export async function getContent(id: string) {
  const item = await repo.getContentItem(id);
  return item ? presentArticle(item) : null;
}
export async function listApprovedContent(language?: string) {
  return (await repo.listApprovedContent(language)).map(presentArticle);
}
export const countContentByState = repo.countContentByState;

/** Live preview of the editor body without persisting anything. */
export function previewBody(source: string, language: string) {
  const normalized = normalizeArticleSource(source).source;
  return {
    html: renderRichText(normalized, directionFor(language)),
    text: richTextToPlain(normalized),
  };
}
