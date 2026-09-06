import "server-only";
import { createHash } from "node:crypto";
import type { ContentItem, Prisma } from "@prisma/client";
import { prepareHebrewTranslation, completeHebrewTranslation, describeTranslationSource, TRANSLATION_VERSION, TranslationContentError } from "../../domain/content/hebrewTranslation";
import { normalizeArticleSource, presentArticle } from "../../domain/content/articleFormat";
import { renderRichText } from "../../domain/content/richText";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { currentJob } from "../jobs/context";
import { getTranslationProvider } from "../integrations/translation";
import { TranslationProviderError } from "../integrations/translation/translationProvider";
import { chatgptTranslationPrompt, importChatgptTranslation } from "../../domain/content/chatgptTranslation";
import { createChatgptReceipt, verifyChatgptReceipt } from "./chatgptTranslationToken";

const RUN_TIMEOUT_MS = 120_000;
const MANUAL_MODEL = "CHATGPT_MANUAL_UNVERIFIED";
type Result = { ok: true; contentItemId: string; reused: boolean } | { ok: false; message: string };
const fail = (message: string): Result => ({ ok: false, message });

function sourceSnapshot(item: ContentItem) {
  const source = presentArticle(item);
  return { title: source.title, summary: source.summary, bodyText: source.bodyText,
    externalUrl: source.externalUrl, imageUrl: source.imageUrl, imageAlt: source.imageAlt,
    sourceId: source.sourceId, sourceName: source.sourceName, author: source.author,
    publishedAt: source.publishedAt?.toISOString() ?? null };
}
function fingerprint(item: ContentItem) {
  return createHash("sha256").update(JSON.stringify({ version: TRANSLATION_VERSION, source: sourceSnapshot(item) })).digest("hex");
}

function translatedDraft(source: ContentItem, translated: ReturnType<typeof completeHebrewTranslation>, actorId: string): Prisma.ContentItemUncheckedCreateInput {
  const data = sourceSnapshot(source);
  return { title: translated.title, summary: translated.summary || null, bodyText: translated.body || null,
    bodyHtml: translated.body ? renderRichText(translated.body, "rtl") : null,
    language: "HE", origin: "INGESTED", reviewState: "PENDING_REVIEW", createdById: actorId,
    sourceId: data.sourceId, sourceName: data.sourceName, author: data.author,
    imageUrl: data.imageUrl, imageAlt: data.imageAlt, externalUrl: data.externalUrl,
    publishedAt: source.publishedAt, ctaLabel: data.externalUrl ? "לכתבה המלאה" : null, ctaUrl: data.externalUrl };
}

/** Preparing a copy/paste prompt makes no database write and no provider call. */
export async function prepareArticleForChatgpt(id: string) {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  if (currentJob()) return { ok: false as const, message: "A staff member must prepare this article." };
  const source = await getPrisma().contentItem.findUnique({ where: { id }, include: { translationResult: true } });
  if (!source || source.origin !== "INGESTED" || source.language === "HE" || source.translationResult)
    return { ok: false as const, message: "Choose an original external article to translate." };
  try {
    const snapshot = sourceSnapshot(source);
    const plan = prepareHebrewTranslation(snapshot); const sourceHash = fingerprint(source);
    return { ok: true as const, prompt: chatgptTranslationPrompt(plan, sourceHash), receipt: createChatgptReceipt(id, actor.id, sourceHash), source: describeTranslationSource(snapshot) };
  } catch (error) {
    return { ok: false as const, message: error instanceof TranslationContentError ? error.message : "The article could not be prepared. Ask your administrator to check the server configuration." };
  }
}

/** User-supplied text, never represented as a verified API response or model identity. */
export async function saveArticleFromChatgpt(id: string, receipt: string, reply: string): Promise<Result> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  if (currentJob()) return fail("A staff member must import this translation.");
  const verified = verifyChatgptReceipt(receipt, id, actor.id);
  if (!verified) return fail("This preparation has expired or belongs to another AXIS account. Prepare a new ChatGPT prompt from this article.");
  if (reply.length > 200_000) return fail("That response is too large. Paste up to 200,000 characters.");
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(165239, 37)`;
      await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id=${id} FOR UPDATE`;
      const source = await tx.contentItem.findUnique({ where: { id }, include: { translationResult: true } });
      if (!source || source.origin !== "INGESTED" || source.language === "HE" || source.translationResult)
        return fail("Choose an original external article to translate.");
      if (fingerprint(source) !== verified.sourceHash)
        return fail("The original article changed after the prompt was prepared. Prepare a new prompt so the Hebrew draft matches the current source.");
      const translated = importChatgptTranslation(prepareHebrewTranslation(sourceSnapshot(source)), verified.sourceHash, reply);
      const cached = await tx.contentTranslation.findFirst({ where: { sourceContentItemId: id, sourceHash: verified.sourceHash,
        state: "READY", generatedContentItemId: { not: null } }, orderBy: { createdAt: "desc" } });
      if (cached?.generatedContentItemId) return { ok: true as const, contentItemId: cached.generatedContentItemId, reused: true };
      if (await tx.contentTranslation.count({ where: { sourceContentItemId: id, state: "RUNNING", createdAt: { gte: new Date(Date.now() - RUN_TIMEOUT_MS) } } }))
        return fail("An automatic translation is already running for this article. Wait for it to finish before importing another version.");
      const user = await tx.user.findUnique({ where: { id: actor.id } });
      if (!user?.isActive || user.mustChangePassword || user.isSystemAccount) return fail("Your account is no longer available for this action.");
      const article = await tx.contentItem.create({ data: translatedDraft(source, translated, actor.id) });
      const attempt = await tx.contentTranslation.create({ data: { sourceContentItemId: id, sourceHash: verified.sourceHash,
        requestedById: actor.id, model: MANUAL_MODEL, state: "READY", generatedContentItemId: article.id, completedAt: new Date() } });
      await tx.auditLog.create({ data: { action: "ARTICLE_TRANSLATION_DRAFT_CREATED", actorUserId: actor.id,
        entityType: "ContentTranslation", entityId: attempt.id, toState: "READY", metadata: {
          sourceContentItemId: id, generatedContentItemId: article.id, targetLanguage: "HE", sourceHash: verified.sourceHash,
          method: "MANUAL_IMPORT", modelVerified: false,
        } } });
      return { ok: true as const, contentItemId: article.id, reused: false };
    });
  } catch (error) {
    return fail(error instanceof TranslationContentError ? error.message : "This reply could not be saved. Your original article is unchanged.");
  }
}

export async function getArticleTranslationStatus(id: string) {
  await requireCapability(Capability.MANAGE_CONTENT);
  const prisma = getPrisma();
  const provider = getTranslationProvider();
  const item = await prisma.contentItem.findUnique({ where: { id } });
  const result = await prisma.contentTranslation.findUnique({ where: { generatedContentItemId: id },
    include: { sourceContentItem: true } });
  if (result) return { configuration: provider.checkConfiguration(), eligible: false, source: null, sourceRef: null,
    original: { ...presentArticle(result.sourceContentItem),
      bodyText: normalizeArticleSource(result.sourceContentItem.bodyText, result.sourceContentItem.externalUrl).source,
      changedSinceTranslation: fingerprint(result.sourceContentItem) !== result.sourceHash }, latest: null };
  const latest = await prisma.contentTranslation.findFirst({ where: { sourceContentItemId: id },
    orderBy: { createdAt: "desc" }, select: { state: true, generatedContentItemId: true, createdAt: true, errorCode: true } });
  return { configuration: provider.checkConfiguration(), eligible: item?.origin === "INGESTED" && item.language !== "HE",
    source: item ? describeTranslationSource(sourceSnapshot(item)) : null,
    sourceRef: item ? fingerprint(item) : null,
    original: null, latest: latest ? { ...latest, state: latest.state === "RUNNING" && Date.now() - latest.createdAt.getTime() > RUN_TIMEOUT_MS ? "FAILED" : latest.state } : null };
}

/** One human request; the only side effect is a separate, unapproved Hebrew article. */
export async function createHebrewArticleTranslation(id: string): Promise<Result> {
  const actor = await requireCapability(Capability.MANAGE_CONTENT);
  if (currentJob()) return fail("A staff member must request a translation from the article page.");
  const prisma = getPrisma();
  const original = await prisma.contentItem.findUnique({ where: { id }, include: { translationResult: { select: { id: true } } } });
  if (!original || original.origin !== "INGESTED") return fail("Choose an external article to translate.");
  if (original.language === "HE" || original.translationResult) return fail("This article already has a Hebrew version. Edit and review that version instead.");
  let plan: ReturnType<typeof prepareHebrewTranslation>;
  try { plan = prepareHebrewTranslation(sourceSnapshot(original)); }
  catch (error) { return fail(error instanceof TranslationContentError ? error.message : "That article could not be prepared for translation."); }
  const sourceHash = fingerprint(original);
  const provider = getTranslationProvider();
  const admission = await prisma.$transaction(async tx => {
    // All replicas share the same short admission lock; never held across network I/O.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(165239, 37)`;
    const now = new Date();
    const expired = await tx.contentTranslation.findMany({ where: { state: "RUNNING", createdAt: { lt: new Date(now.getTime() - RUN_TIMEOUT_MS) } },
      select: { id: true }, take: 100 });
    for (const row of expired) {
      const changed = await tx.contentTranslation.updateMany({ where: { id: row.id, state: "RUNNING" },
        data: { state: "FAILED", errorCode: "INTERRUPTED", completedAt: now } });
      if (changed.count) await tx.auditLog.create({ data: { action: "ARTICLE_TRANSLATION_FAILED", actorUserId: actor.id,
        entityType: "ContentTranslation", entityId: row.id, fromState: "RUNNING", toState: "FAILED", metadata: { code: "INTERRUPTED" } } });
    }
    const cached = await tx.contentTranslation.findFirst({ where: { sourceContentItemId: id, sourceHash,
      state: "READY", generatedContentItemId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (cached?.generatedContentItemId) return { reusedId: cached.generatedContentItemId };
    if (!provider.checkConfiguration().configured) return { error: provider.checkConfiguration().message };
    const busy = await tx.contentTranslation.count({ where: { sourceContentItemId: id, state: "RUNNING" } });
    if (busy) return { error: "A Hebrew translation is already being prepared. Refresh this page shortly." };
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const [active, total, personal, recent] = await Promise.all([
      tx.contentTranslation.count({ where: { state: "RUNNING" } }),
      tx.contentTranslation.count({ where: { model: { not: MANUAL_MODEL }, createdAt: { gte: dayStart } } }),
      tx.contentTranslation.count({ where: { model: { not: MANUAL_MODEL }, requestedById: actor.id, createdAt: { gte: dayStart } } }),
      tx.contentTranslation.count({ where: { model: { not: MANUAL_MODEL }, requestedById: actor.id, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
    ]);
    if (active >= 2) return { error: "Two translations are already running. Please try again shortly." };
    if (total >= 100 || personal >= 20 || recent >= 5) return { error: "The translation request limit has been reached. Try again later or ask your administrator." };
    const attempt = await tx.contentTranslation.create({ data: { sourceContentItemId: id, sourceHash,
      requestedById: actor.id, model: provider.model, targetLanguage: "HE" } });
    await tx.auditLog.create({ data: { action: "ARTICLE_TRANSLATION_REQUESTED", actorUserId: actor.id,
      entityType: "ContentTranslation", entityId: attempt.id, toState: "RUNNING",
      metadata: { sourceContentItemId: id, sourceHash, model: provider.model, targetLanguage: "HE" } } });
    return { attemptId: attempt.id };
  });
  if (admission.reusedId) return { ok: true, contentItemId: admission.reusedId, reused: true };
  if (!admission.attemptId) return fail(admission.error ?? "Translation could not be started.");
  const attemptId = admission.attemptId;
  try {
    const translated = completeHebrewTranslation(plan, await provider.translate(plan.segments));
    // Re-check the human/session after an asynchronous provider call.
    const completingActor = await requireCapability(Capability.MANAGE_CONTENT);
    if (completingActor.id !== actor.id) throw new TranslationProviderError("ACTOR_CHANGED", "Your session changed. No translation was saved.");
    const created = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ContentTranslation" WHERE id=${attemptId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id=${id} FOR UPDATE`;
      const attempt = await tx.contentTranslation.findUniqueOrThrow({ where: { id: attemptId } });
      const source = await tx.contentItem.findUnique({ where: { id } });
      const user = await tx.user.findUnique({ where: { id: actor.id } });
      if (attempt.state !== "RUNNING" || Date.now() - attempt.createdAt.getTime() > RUN_TIMEOUT_MS)
        throw new TranslationProviderError("INTERRUPTED", "This translation expired. No draft was saved; please try again.");
      if (!source || fingerprint(source) !== sourceHash)
        throw new TranslationProviderError("SOURCE_CHANGED", "The source changed while translating. Review it and request a fresh translation.");
      if (!user?.isActive || user.mustChangePassword || user.isSystemAccount)
        throw new TranslationProviderError("ACTOR_CHANGED", "Your account is no longer available for this action.");
      const article = await tx.contentItem.create({ data: translatedDraft(source, translated, actor.id) });
      await tx.contentTranslation.update({ where: { id: attemptId }, data: { state: "READY", generatedContentItemId: article.id, completedAt: new Date() } });
      await tx.auditLog.create({ data: { action: "ARTICLE_TRANSLATION_DRAFT_CREATED", actorUserId: actor.id,
        entityType: "ContentTranslation", entityId: attemptId, fromState: "RUNNING", toState: "READY",
        metadata: { sourceContentItemId: id, generatedContentItemId: article.id, targetLanguage: "HE", sourceHash, model: provider.model } } });
      return article;
    });
    return { ok: true, contentItemId: created.id, reused: false };
  } catch (error) {
    const code = error instanceof TranslationProviderError ? error.code : error instanceof TranslationContentError ? "INVALID_CONTENT" : "TRANSLATION_FAILED";
    await prisma.$transaction(async tx => {
      const changed = await tx.contentTranslation.updateMany({ where: { id: attemptId, state: "RUNNING" },
        data: { state: "FAILED", errorCode: code, completedAt: new Date() } });
      if (changed.count) await tx.auditLog.create({ data: { action: "ARTICLE_TRANSLATION_FAILED", actorUserId: actor.id,
        entityType: "ContentTranslation", entityId: attemptId, fromState: "RUNNING", toState: "FAILED", metadata: { code } } });
    });
    return fail(error instanceof TranslationContentError || error instanceof TranslationProviderError ? error.message : "The translation could not finish. No draft was saved; you can try again.");
  }
}
