import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../src/server/db/prisma";
import { actAs, actAsNobody, clearTestActor, createTestUser, type TestUser } from "../support/actor";
import { createHebrewArticleTranslation, getArticleTranslationStatus, prepareArticleForChatgpt, saveArticleFromChatgpt } from "../../src/server/services/articleTranslationService";
import { setTranslationProviderForTesting } from "../../src/server/integrations/translation";
import type { TranslationSegment } from "../../src/domain/content/hebrewTranslation";
import type { TranslationProvider } from "../../src/server/integrations/translation/translationProvider";
import { deleteContent } from "../../src/server/services/contentService";
import { approveContent } from "../../src/server/services/contentReviewService";
import { createDraftFromContent } from "../../src/server/services/newsletterDraftService";
import { getNewsletterPreview } from "../../src/server/services/newsletterService";

class SyntheticTranslator implements TranslationProvider {
  model = "synthetic-hebrew";
  requests: TranslationSegment[][] = [];
  work?: () => Promise<void>;
  malformed = false;
  checkConfiguration() { return { configured: true, message: "Synthetic test translator" }; }
  async translate(segments: TranslationSegment[]) {
    this.requests.push(segments);
    await this.work?.();
    if (this.malformed) return [];
    return segments.map(row => ({ id: row.id, text: `תרגום לבדיקה ${row.text}` }));
  }
}

describe("Hebrew article translation", () => {
  const prisma = getPrisma(); const sourceIds: string[] = []; const campaignIds: string[] = [];
  let actor: TestUser; let provider: SyntheticTranslator;
  beforeAll(async () => { actor = await createTestUser({ prefix: "translate", role: "MANAGER" }); actAs(actor); });
  afterEach(() => { actAs(actor); setTranslationProviderForTesting(undefined); });
  afterAll(async () => {
    const attempts = await prisma.contentTranslation.findMany({ where: { sourceContentItemId: { in: sourceIds } } });
    const generatedIds = attempts.flatMap(row => row.generatedContentItemId ? [row.generatedContentItemId] : []);
    await prisma.campaignContentItem.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: actor.id } });
    await prisma.contentTranslation.deleteMany({ where: { sourceContentItemId: { in: sourceIds } } });
    await prisma.contentItem.deleteMany({ where: { id: { in: [...sourceIds, ...generatedIds] } } });
    await prisma.user.delete({ where: { id: actor.id } });
    clearTestActor(); await prisma.$disconnect();
  });
  async function source() {
    provider = new SyntheticTranslator(); setTranslationProviderForTesting(provider);
    const item = await prisma.contentItem.create({ data: { title: `NavVis CLX surveying ${randomUUID().slice(0,8)}`,
      summary: "A scanner with 40 m range.", bodyText: "## Mapping\n\nWorking with **Trimble SX12**.\n\n- Capture point clouds\n- Keep accurate measurements",
      origin: "INGESTED", language: "UNKNOWN", reviewState: "APPROVED", sourceName: "Synthetic publisher",
      externalUrl: "https://example.com/scanner", internalNote: "Private staff note that must never leave AXIS" } });
    sourceIds.push(item.id); return item;
  }
  async function manualPreparation(id: string) {
    const prepared = await prepareArticleForChatgpt(id);
    if (!prepared.ok) throw new Error(prepared.message);
    const data = JSON.parse(prepared.prompt.split("ARTICLE_DATA:\n")[1]) as { sourceRef: string; segments: TranslationSegment[] };
    const reply = JSON.stringify({ ...data, segments: data.segments.map(row => ({ ...row, text: `תרגום לבדיקה ${row.text}` })) });
    return { ...prepared, reply };
  }
  it("imports a Hebrew draft with no API access, retaining provenance and review gates", async () => {
    const original = await source(); setTranslationProviderForTesting(undefined);
    const prepared = await manualPreparation(original.id);
    expect(prepared.prompt).not.toContain(original.internalNote);
    expect(prepared.prompt).not.toContain(actor.id); expect(prepared.prompt).not.toContain(prepared.receipt);
    expect(await prisma.contentTranslation.count({ where: { sourceContentItemId: original.id } })).toBe(0);
    const result = await saveArticleFromChatgpt(original.id, prepared.receipt, prepared.reply);
    if (!result.ok) throw new Error(result.message);
    const translated = await prisma.contentItem.findUniqueOrThrow({ where: { id: result.contentItemId } });
    expect(translated.language).toBe("HE"); expect(translated.reviewState).toBe("PENDING_REVIEW");
    expect(translated.bodyHtml).toContain('<span dir="ltr">Trimble SX12</span>');
    expect(translated.externalUrl).toBe(original.externalUrl);
    expect(await prisma.contentItem.findUnique({ where: { id: original.id } })).toEqual(original);
    expect((await createDraftFromContent({ contentItemIds: [translated.id] })).ok).toBe(false);
    expect(provider.requests).toHaveLength(0);
    const history = await prisma.contentTranslation.findUniqueOrThrow({ where: { generatedContentItemId: translated.id } });
    expect(history.model).toBe("CHATGPT_MANUAL_UNVERIFIED");
    expect(await prisma.campaign.count({ where: { createdById: actor.id } })).toBe(0);
  });
  it("refreshes source coverage and refuses an old excerpt reply after the full body is added", async () => {
    const original = await source();
    await prisma.contentItem.update({ where: { id: original.id }, data: { bodyText: null, summary: "A short introduction…" } });
    const excerpt = await manualPreparation(original.id);
    expect(excerpt.source.bodyWordCount).toBe(0); expect(excerpt.source.excerptAppearsCutOff).toBe(true);
    const before = await getArticleTranslationStatus(original.id);
    expect(before.source).toEqual(excerpt.source);
    await prisma.contentItem.update({ where: { id: original.id }, data: { bodyText: "Opening passage.\n\nThe final paragraph of the supplied article." } });
    const full = await manualPreparation(original.id);
    expect(full.source.bodyWordCount).toBeGreaterThan(0);
    expect(full.prompt).toContain("The final paragraph of the supplied article.");
    expect((await getArticleTranslationStatus(original.id)).sourceRef).not.toBe(before.sourceRef);
    const stale = await saveArticleFromChatgpt(original.id, excerpt.receipt, excerpt.reply);
    expect(stale.ok).toBe(false); if (!stale.ok) expect(stale.message).toContain("changed");
    const saved = await saveArticleFromChatgpt(original.id, full.receipt, full.reply);
    if (!saved.ok) throw new Error(saved.message);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: saved.contentItemId } })).bodyText).toContain("The final paragraph of the supplied article.");
    expect(provider.requests).toHaveLength(0);
  });
  it("imports concurrent copies once and preserves subsequent staff edits", async () => {
    const original = await source(); const prepared = await manualPreparation(original.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => saveArticleFromChatgpt(original.id, prepared.receipt, prepared.reply)));
    expect(results.every(row => row.ok)).toBe(true);
    const ids = results.map(row => row.ok ? row.contentItemId : null); expect(new Set(ids).size).toBe(1);
    const id = ids[0]!;
    await prisma.contentItem.update({ where: { id }, data: { title: "עריכה ידנית" } });
    expect(await saveArticleFromChatgpt(original.id, prepared.receipt, prepared.reply)).toEqual({ ok: true, contentItemId: id, reused: true });
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id } })).title).toBe("עריכה ידנית");
    expect(provider.requests).toHaveLength(0);
  });
  it("rejects tampered receipts, partial replies and stale source text without writes", async () => {
    const original = await source(); const prepared = await manualPreparation(original.id);
    expect((await saveArticleFromChatgpt(original.id, prepared.receipt + "x", prepared.reply)).ok).toBe(false);
    expect((await saveArticleFromChatgpt(original.id, prepared.receipt, "{}")).ok).toBe(false);
    await prisma.contentItem.update({ where: { id: original.id }, data: { summary: "Changed while using ChatGPT" } });
    const stale = await saveArticleFromChatgpt(original.id, prepared.receipt, prepared.reply);
    expect(stale.ok).toBe(false); if (!stale.ok) expect(stale.message).toContain("changed");
    expect(await prisma.contentTranslation.count({ where: { sourceContentItemId: original.id } })).toBe(0);
    expect(provider.requests).toHaveLength(0);
  });
  it("requires authentication for preparing and importing a ChatGPT translation", async () => {
    const original = await source(); const prepared = await manualPreparation(original.id);
    actAsNobody();
    await expect(prepareArticleForChatgpt(original.id)).rejects.toThrow();
    await expect(saveArticleFromChatgpt(original.id, prepared.receipt, prepared.reply)).rejects.toThrow();
    actAs(actor);
  });
  it("creates a separate unapproved Hebrew article with original provenance and no campaign writes", async () => {
    const original = await source();
    const result = await createHebrewArticleTranslation(original.id);
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.message);
    const translated = await prisma.contentItem.findUniqueOrThrow({ where: { id: result.contentItemId } });
    expect(translated.id).not.toBe(original.id); expect(translated.language).toBe("HE");
    expect(translated.reviewState).toBe("PENDING_REVIEW"); expect(translated.reviewedAt).toBeNull();
    expect(translated.bodyHtml).toContain('<span dir="ltr">Trimble SX12</span>');
    expect(translated.summary).toContain("40 m"); expect(translated.externalUrl).toBe(original.externalUrl);
    expect(translated.internalNote).toBeNull(); expect(translated.externalId).toBeNull();
    expect(JSON.stringify(provider.requests)).not.toContain(original.internalNote);
    expect(await prisma.contentItem.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.campaign.count({ where: { createdById: actor.id } })).toBe(0);
    const context = await getArticleTranslationStatus(translated.id);
    expect(context.original?.id).toBe(original.id);
    expect(context.original?.changedSinceTranslation).toBe(false);
    expect((await deleteContent(original.id)).ok).toBe(false);
    const draftBefore = await createDraftFromContent({ contentItemIds: [translated.id] });
    expect(draftBefore.ok).toBe(false);
    await approveContent(translated.id);
    const draft = await createDraftFromContent({ contentItemIds: [translated.id] });
    expect(draft.ok).toBe(true); if (!draft.ok) throw new Error(draft.message);
    campaignIds.push(draft.campaignId);
    const preview = await getNewsletterPreview(draft.campaignId);
    expect(preview?.html).toContain('dir="rtl"'); expect(preview?.text).toContain("תרגום לבדיקה");
    expect(await prisma.campaignRecipient.count({ where: { campaignId: draft.campaignId } })).toBe(0);
  });
  it("reuses a finished translation without overwriting human edits or calling the provider again", async () => {
    const original = await source(); const first = await createHebrewArticleTranslation(original.id);
    if (!first.ok) throw new Error(first.message);
    await prisma.contentItem.update({ where: { id: first.contentItemId }, data: { title: "עריכה אנושית" } });
    const second = await createHebrewArticleTranslation(original.id);
    expect(second).toEqual({ ok: true, contentItemId: first.contentItemId, reused: true });
    expect(provider.requests).toHaveLength(1);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: first.contentItemId } })).title).toBe("עריכה אנושית");
    await prisma.contentItem.update({ where: { id: original.id }, data: { summary: "Source changed after review" } });
    expect((await getArticleTranslationStatus(first.contentItemId)).original?.changedSinceTranslation).toBe(true);
  });
  it("claims concurrent requests once", async () => {
    const original = await source();
    let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    provider.work = () => { entered(); return new Promise<void>(resolve => { release = resolve; }); };
    const first = createHebrewArticleTranslation(original.id); await ready;
    const second = await createHebrewArticleTranslation(original.id);
    expect(second.ok).toBe(false); if (!second.ok) expect(second.message).toContain("already being prepared");
    release(); expect((await first).ok).toBe(true); expect(provider.requests).toHaveLength(1);
  });
  it("discards a result if the source changes during translation", async () => {
    const original = await source();
    provider.work = async () => { await prisma.contentItem.update({ where: { id: original.id }, data: { summary: "Changed source" } }); };
    expect((await createHebrewArticleTranslation(original.id)).ok).toBe(false);
    const attempt = await prisma.contentTranslation.findFirstOrThrow({ where: { sourceContentItemId: original.id } });
    expect(attempt.state).toBe("FAILED"); expect(attempt.errorCode).toBe("SOURCE_CHANGED"); expect(attempt.generatedContentItemId).toBeNull();
  });
  it("refuses unauthenticated and unconfigured translation without a provider request", async () => {
    const original = await source(); actAsNobody();
    await expect(createHebrewArticleTranslation(original.id)).rejects.toThrow(); actAs(actor);
    setTranslationProviderForTesting(undefined);
    expect((await createHebrewArticleTranslation(original.id)).ok).toBe(false);
    expect(provider.requests).toHaveLength(0);
    expect(await prisma.contentTranslation.count({ where: { sourceContentItemId: original.id } })).toBe(0);
  });
  it("refuses malformed output with no partial draft", async () => {
    // Age only this suite's attempts to stay below the per-minute admission budget.
    await prisma.contentTranslation.updateMany({ where: { requestedById: actor.id }, data: { createdAt: new Date(Date.now() - 65_000) } });
    const original = await source(); provider.malformed = true;
    const result = await createHebrewArticleTranslation(original.id); expect(result.ok).toBe(false);
    const row = await prisma.contentTranslation.findFirstOrThrow({ where: { sourceContentItemId: original.id } });
    expect(row.state).toBe("FAILED"); expect(row.generatedContentItemId).toBeNull();
  });
  it("refuses expired completion and audits the interruption without creating an article", async () => {
    const original = await source();
    provider.work = async () => { await prisma.contentTranslation.updateMany({
      where: { sourceContentItemId: original.id, state: "RUNNING" }, data: { createdAt: new Date(Date.now() - 130_000) },
    }); };
    expect((await createHebrewArticleTranslation(original.id)).ok).toBe(false);
    const attempt = await prisma.contentTranslation.findFirstOrThrow({ where: { sourceContentItemId: original.id } });
    expect(attempt.state).toBe("FAILED"); expect(attempt.errorCode).toBe("INTERRUPTED");
    expect(attempt.generatedContentItemId).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: attempt.id, action: "ARTICLE_TRANSLATION_FAILED" } })).toBe(1);
  });
  it("honors the persisted per-person request limit before provider I/O", async () => {
    const original = await source();
    await prisma.contentTranslation.createMany({ data: Array.from({ length: 5 }, () => ({ sourceContentItemId: original.id,
      sourceHash: "synthetic-quota", requestedById: actor.id, model: provider.model, state: "FAILED" as const })) });
    expect((await createHebrewArticleTranslation(original.id)).ok).toBe(false); expect(provider.requests).toHaveLength(0);
  });
});
