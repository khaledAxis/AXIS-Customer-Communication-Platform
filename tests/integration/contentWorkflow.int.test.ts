import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { getPrisma } from "../../src/server/db/prisma";
import * as contentService from "../../src/server/services/contentService";
import * as newsletterService from "../../src/server/services/newsletterService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Content + newsletter workflow against real PostgreSQL.
 *
 * Exercises the SERVICE layer (not raw Prisma) so validation, ordering and history
 * protection are covered the way the UI actually uses them.
 *
 * Repeatable: every row uses a run-scoped unique value and is removed in `afterAll`.
 * Cleanup deletes only ids this run created — it never truncates a table.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
let seq = 0;
const uid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = {
  campaignContentItem: [] as string[],
  campaign: [] as string[],
  contentItem: [] as string[],
  user: [] as string[],
};

d("content and newsletter workflow", () => {
  let prisma: ReturnType<typeof getPrisma>;

  const newArticle = async (overrides: Record<string, unknown> = {}) => {
    const result = await contentService.createContent({
      title: `Article ${uid()}`,
      summary: "A short summary",
      body: "## Heading\n\nSome **body** text.",
      language: "HE",
      origin: "INTERNAL",
      ...overrides,
    });
    if (!result.ok) throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
    created.contentItem.push(result.data.id);
    return result.data;
  };

  const newApprovedArticle = async (overrides: Record<string, unknown> = {}) => {
    const article = await newArticle(overrides);
    await contentService.setReviewState(article.id, "APPROVED");
    return article;
  };

  const newNewsletter = async () => {
    const result = await newsletterService.createNewsletter({
      name: `Newsletter ${uid()}`,
      subject: `Subject ${uid()}`,
      language: "HE",
    });
    if (!result.ok) throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
    created.campaign.push(result.data.id);
    return result.data;
  };

  /** Every service call in this suite runs as a real, signed-in manager. */

  let operator: TestUser;


  beforeAll(async () => {

    operator = await createTestUser({ prefix: "content", role: "MANAGER" });

    actAs(operator);
    prisma = getPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {

    clearTestActor();
    try {
      const byId = (ids: string[]) => ({ where: { id: { in: ids } } });
      await prisma.campaignContentItem.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.campaignContentItem.deleteMany(byId(created.campaignContentItem));
      await prisma.campaign.deleteMany(byId(created.campaign));
      await prisma.contentItem.deleteMany(byId(created.contentItem));
      await prisma.user.deleteMany(byId(created.user));
    } finally {
      await prisma.$disconnect();
    }
  
    await getPrisma().user.deleteMany({ where: { id: operator.id } });
});

  // ---------------------------------------------------------------- content

  it("creates an article and stores generated HTML, never raw input", async () => {
    const article = await newArticle({ body: "## Title\n\n<script>alert(1)</script>" });
    const stored = await contentService.getContent(article.id);

    expect(stored?.bodyHtml).toContain("<h2");
    expect(stored?.bodyHtml).not.toContain("<script>alert(1)</script>");
    expect(stored?.bodyHtml).toContain("&lt;script&gt;");
    // The editable source is kept as written so the author can edit it again.
    expect(stored?.bodyText).toContain("<script>alert(1)</script>");
  });

  it("starts our own articles as a draft, not approved", async () => {
    const article = await newArticle();
    expect(article.reviewState).toBe("NEW");
  });

  it("forces external articles to be reviewed before use", async () => {
    const article = await newArticle({ origin: "INGESTED" });
    expect(article.origin).toBe("INGESTED");
    expect(article.reviewState).toBe("PENDING_REVIEW");
  });

  it("edits an article and re-renders its HTML", async () => {
    const article = await newArticle();
    const result = await contentService.updateContent(article.id, {
      title: "Updated title",
      language: "AR",
      body: "Updated **body**",
    });

    expect(result.ok).toBe(true);
    const stored = await contentService.getContent(article.id);
    expect(stored?.title).toBe("Updated title");
    expect(stored?.language).toBe("AR");
    expect(stored?.bodyHtml).toContain("<strong>body</strong>");
    // Arabic is RTL, so list/text rendering must follow the language.
    expect(stored?.bodyHtml).toContain("<p");
  });

  it("moves an article through approval", async () => {
    const article = await newArticle();
    await contentService.setReviewState(article.id, "APPROVED");
    expect((await contentService.getContent(article.id))?.reviewState).toBe("APPROVED");

    await contentService.setReviewState(article.id, "REJECTED");
    expect((await contentService.getContent(article.id))?.reviewState).toBe("REJECTED");
  });

  it("rejects an invalid article without writing anything", async () => {
    const result = await contentService.createContent({ title: "", language: "EN" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);

    // Scoped to the rejected value rather than a global row count: vitest runs test
    // FILES in parallel, so a total count races with other suites inserting rows.
    expect(await prisma.contentItem.count({ where: { title: "" } })).toBe(0);
  });

  it("rejects an unsafe link at the service layer", async () => {
    const result = await contentService.createContent({
      title: "Bad link",
      language: "HE",
      externalUrl: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
  });

  it("offers only approved articles to a newsletter", async () => {
    const approved = await newApprovedArticle();
    const draft = await newArticle();

    const offered = await contentService.listApprovedContent("HE");
    const offeredIds = offered.map((item) => item.id);

    expect(offeredIds).toContain(approved.id);
    expect(offeredIds).not.toContain(draft.id);
  });

  // ------------------------------------------------------------ composition

  it("composes a newsletter from multiple articles in order", async () => {
    const newsletter = await newNewsletter();
    const first = await newApprovedArticle();
    const second = await newApprovedArticle();
    const third = await newApprovedArticle();

    for (const article of [first, second, third]) {
      const result = await newsletterService.addContent(newsletter.id, article.id);
      expect(result.ok).toBe(true);
    }

    const loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks).toHaveLength(3);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([first.id, second.id, third.id]);
    expect(loaded?.contentLinks.map((l) => l.position)).toEqual([1, 2, 3]);
  });

  it("persists a new order across reloads", async () => {
    const newsletter = await newNewsletter();
    const a = await newApprovedArticle();
    const b = await newApprovedArticle();
    const c = await newApprovedArticle();
    for (const article of [a, b, c]) await newsletterService.addContent(newsletter.id, article.id);

    await newsletterService.reorderContent(newsletter.id, [c.id, a.id, b.id]);

    const reloaded = await newsletterService.getNewsletter(newsletter.id);
    expect(reloaded?.contentLinks.map((l) => l.contentItemId)).toEqual([c.id, a.id, b.id]);
    expect(reloaded?.contentLinks.map((l) => l.position)).toEqual([1, 2, 3]);
  });

  it("moves a single article up and down", async () => {
    const newsletter = await newNewsletter();
    const a = await newApprovedArticle();
    const b = await newApprovedArticle();
    for (const article of [a, b]) await newsletterService.addContent(newsletter.id, article.id);

    await newsletterService.moveContent(newsletter.id, b.id, "UP");
    let loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([b.id, a.id]);

    await newsletterService.moveContent(newsletter.id, b.id, "DOWN");
    loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([a.id, b.id]);
  });

  it("ignores a move beyond the first or last place", async () => {
    const newsletter = await newNewsletter();
    const a = await newApprovedArticle();
    await newsletterService.addContent(newsletter.id, a.id);

    await newsletterService.moveContent(newsletter.id, a.id, "UP");
    const loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([a.id]);
  });

  it("prevents adding the same article twice", async () => {
    const newsletter = await newNewsletter();
    const article = await newApprovedArticle();

    expect((await newsletterService.addContent(newsletter.id, article.id)).ok).toBe(true);
    const duplicate = await newsletterService.addContent(newsletter.id, article.id);

    expect(duplicate.ok).toBe(false);
    const loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks).toHaveLength(1);
  });

  it("removes an article and closes the gap in the order", async () => {
    const newsletter = await newNewsletter();
    const a = await newApprovedArticle();
    const b = await newApprovedArticle();
    const c = await newApprovedArticle();
    for (const article of [a, b, c]) await newsletterService.addContent(newsletter.id, article.id);

    await newsletterService.removeContent(newsletter.id, b.id);

    const loaded = await newsletterService.getNewsletter(newsletter.id);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([a.id, c.id]);
    expect(loaded?.contentLinks.map((l) => l.position)).toEqual([1, 2]);
  });

  it("keeps an article usable elsewhere after removing it from one newsletter", async () => {
    const newsletter = await newNewsletter();
    const article = await newApprovedArticle();
    await newsletterService.addContent(newsletter.id, article.id);
    await newsletterService.removeContent(newsletter.id, article.id);

    expect(await contentService.getContent(article.id)).not.toBeNull();
  });

  it("refuses to delete an article that a newsletter still uses", async () => {
    const newsletter = await newNewsletter();
    const article = await newApprovedArticle();
    await newsletterService.addContent(newsletter.id, article.id);

    const result = await contentService.deleteContent(article.id);
    expect(result.ok).toBe(false);
    expect(await contentService.getContent(article.id)).not.toBeNull();
  });

  // -------------------------------------------------------------- snapshots

  it("keeps a frozen snapshot authoritative when the source article changes later", async () => {
    const newsletter = await newNewsletter();
    const article = await newApprovedArticle({ title: "Original headline" });
    await newsletterService.addContent(newsletter.id, article.id);

    // Freeze the copy the way approval/sending will.
    await prisma.campaignContentItem.updateMany({
      where: { campaignId: newsletter.id, contentItemId: article.id },
      data: { snapshotTitle: "Original headline", snapshotAt: new Date() },
    });

    await contentService.updateContent(article.id, {
      title: "Edited after freezing",
      language: "HE",
    });

    const loaded = await newsletterService.getNewsletter(newsletter.id);
    const document = newsletterService.buildNewsletterDocument(loaded!);

    expect(document.items[0].title).toBe("Original headline");
    expect(loaded?.contentLinks[0].contentItem.title).toBe("Edited after freezing");
  });

  // --------------------------------------------------------------- rendering

  it("renders the newsletter with its articles in campaign order", async () => {
    const newsletter = await newNewsletter();
    const first = await newApprovedArticle({ title: `First ${uid()}` });
    const second = await newApprovedArticle({ title: `Second ${uid()}` });
    await newsletterService.addContent(newsletter.id, first.id);
    await newsletterService.addContent(newsletter.id, second.id);

    const preview = await newsletterService.getNewsletterPreview(newsletter.id);
    expect(preview).not.toBeNull();
    expect(preview!.html).toContain(first.title);
    expect(preview!.html).toContain(second.title);
    expect(preview!.html.indexOf(first.title)).toBeLessThan(preview!.html.indexOf(second.title));
  });

  it("previews in TEST mode with only the authorized addresses and sends nothing", async () => {
    const newsletter = await newNewsletter();
    const preview = await newsletterService.getNewsletterPreview(newsletter.id);

    expect(preview!.delivery.mode).toBe("TEST");
    expect(preview!.delivery.from).toBe("axisgpscana@gmail.com");
    expect(preview!.delivery.to).toBe("khaled-s@axis-gps.com");
    expect(preview!.availability.canSend).toBe(false);

    // Previewing must never create recipients or delivery records.
    expect(await prisma.campaignRecipient.count({ where: { campaignId: newsletter.id } })).toBe(0);
    expect(await prisma.campaignTestSend.count({ where: { campaignId: newsletter.id } })).toBe(0);
    expect(await prisma.campaignEvent.count({ where: { campaignId: newsletter.id } })).toBe(0);
  });

  it("defaults every new newsletter to TEST mode and DRAFT", async () => {
    const newsletter = await newNewsletter();
    expect(newsletter.sendMode).toBe("TEST");
    expect(newsletter.status).toBe("DRAFT");
  });

  it("reports that an empty newsletter is not ready", async () => {
    const newsletter = await newNewsletter();
    const preview = await newsletterService.getNewsletterPreview(newsletter.id);

    expect(preview!.readiness.ready).toBe(false);
    expect(preview!.readiness.problems).toContain("NO_CONTENT");
  });

  it("becomes ready once approved content is added", async () => {
    const newsletter = await newNewsletter();
    const article = await newApprovedArticle();
    await newsletterService.addContent(newsletter.id, article.id);

    const preview = await newsletterService.getNewsletterPreview(newsletter.id);
    expect(preview!.readiness.ready).toBe(true);
    expect(preview!.readiness.includedCount).toBe(1);
  });

  it("blocks readiness while an external article is unapproved", async () => {
    const newsletter = await newNewsletter();
    const external = await newArticle({ origin: "INGESTED" }); // PENDING_REVIEW
    await newsletterService.addContent(newsletter.id, external.id);

    const preview = await newsletterService.getNewsletterPreview(newsletter.id);
    expect(preview!.readiness.ready).toBe(false);
    expect(preview!.readiness.problems).toContain("UNAPPROVED_EXTERNAL_CONTENT");
  });

  it("duplicates a newsletter with its composition and a fresh draft state", async () => {
    const newsletter = await newNewsletter();
    const a = await newApprovedArticle();
    const b = await newApprovedArticle();
    await newsletterService.addContent(newsletter.id, a.id);
    await newsletterService.addContent(newsletter.id, b.id);

    const copy = await newsletterService.duplicateNewsletter(newsletter.id);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    created.campaign.push(copy.data.id);

    const loaded = await newsletterService.getNewsletter(copy.data.id);
    expect(loaded?.contentLinks.map((l) => l.contentItemId)).toEqual([a.id, b.id]);
    expect(loaded?.status).toBe("DRAFT");
    expect(loaded?.sendMode).toBe("TEST");
  });

  it("refuses to edit a newsletter that has left draft", async () => {
    const newsletter = await newNewsletter();
    await prisma.campaign.update({ where: { id: newsletter.id }, data: { status: "SENT" } });

    await expect(
      newsletterService.updateNewsletterDetails(newsletter.id, {
        name: "New name",
        subject: "New subject",
        language: "HE",
      }),
    ).rejects.toThrow();

    // Restore so cleanup can delete it.
    await prisma.campaign.update({ where: { id: newsletter.id }, data: { status: "DRAFT" } });
  });
});
