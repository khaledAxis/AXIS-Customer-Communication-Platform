import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getPrisma } from "../../src/server/db/prisma";
import {
  setFeedFetcherForTesting,
  type FeedFetchResult,
} from "../../src/server/integrations/content/feedFetcher";
import {
  setEmailProviderForTesting,
  setProductionEmailProviderForTesting,
} from "../../src/server/integrations/email";
import * as automationService from "../../src/server/services/automationService";
import * as ingestionService from "../../src/server/services/contentIngestionService";
import * as reviewService from "../../src/server/services/contentReviewService";
import * as sourceService from "../../src/server/services/contentSourceService";
import * as draftService from "../../src/server/services/newsletterDraftService";
import { actAs, actAsNobody, clearTestActor, createTestUser, type TestUser } from "../support/actor";

/**
 * Content sources, ingestion, review and assisted automation (ADR-0026), against real
 * PostgreSQL.
 *
 * NO TEST HERE REACHES THE INTERNET. The feed fetcher is replaced for the whole suite,
 * so a regression that started crawling would show up as a missing stub rather than as
 * traffic to somebody else's website.
 *
 * NO TEST HERE SENDS EMAIL. Both provider registries are cleared, so any accidental
 * call would hit the disabled adapter and throw rather than transmit.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
let seq = 0;
const uid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = {
  source: [] as string[],
  campaign: [] as string[],
  automation: [] as string[],
};

/** A feed whose article links are unique per run, so suites never collide. */
function rssWith(items: { id: string; slug: string; title: string }[]): string {
  const entries = items
    .map(
      (item) => `<item>
        <title>${item.title}</title>
        <link>https://feeds.example.test/${item.slug}</link>
        <guid isPermaLink="false">${item.id}</guid>
        <description>Excerpt for ${item.title}.</description>
        <pubDate>Mon, 03 Aug 2026 09:00:00 GMT</pubDate>
      </item>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Test feed</title><link>https://feeds.example.test</link>
    ${entries}
  </channel></rss>`;
}

const okFetch = (body: string): FeedFetchResult => ({
  ok: true,
  body,
  finalUrl: "https://feeds.example.test/rss",
  contentType: "application/rss+xml",
  byteLength: body.length,
});

d("content sources, review and automation", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let admin: TestUser;
  let manager: TestUser;

  beforeAll(async () => {
    admin = await createTestUser({ prefix: "csadmin", role: "ADMIN" });
    manager = await createTestUser({ prefix: "csmgr", role: "MANAGER" });
    actAs(admin);
    prisma = getPrisma();
    await prisma.$connect();

    // No provider of either kind is reachable from this suite.
    setEmailProviderForTesting(undefined);
    setProductionEmailProviderForTesting(undefined);
  });

  afterEach(() => {
    actAs(admin);
    setFeedFetcherForTesting(undefined);
  });

  afterAll(async () => {
    clearTestActor();
    setFeedFetcherForTesting(undefined);
    try {
      await prisma.newsletterAutomationRun.deleteMany({
        where: { automationId: { in: created.automation } },
      });
      await prisma.newsletterAutomationSource.deleteMany({
        where: { automationId: { in: created.automation } },
      });
      await prisma.newsletterAutomation.deleteMany({
        where: { id: { in: created.automation } },
      });
      await prisma.campaignContentItem.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.campaign.deleteMany({ where: { id: { in: created.campaign } } });
      await prisma.contentItem.deleteMany({ where: { sourceId: { in: created.source } } });
      await prisma.contentIngestionRun.deleteMany({
        where: { sourceId: { in: created.source } },
      });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: created.source } } });
      await prisma.contentSource.deleteMany({ where: { id: { in: created.source } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const newSource = async (overrides: Partial<sourceService.SourceInput> = {}) => {
    const result = await sourceService.createSource({
      name: `Source ${uid()}`,
      kind: "RSS",
      feedUrl: `https://feeds.example.test/${uid()}/rss`,
      language: "HE",
      categories: "hardware, mapping",
      ...overrides,
    });
    if (!result.ok) throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
    created.source.push(result.data.id);
    return result.data.id;
  };

  const ingestInto = async (sourceId: string, body: string) => {
    setFeedFetcherForTesting(async () => okFetch(body));
    return ingestionService.runIngestion({ sourceIds: [sourceId] });
  };

  // ------------------------------------------------------------- 1–3 sources

  it("creates a source", async () => {
    const id = await newSource({ name: `Trimble-like ${uid()}` });
    const source = await prisma.contentSource.findUnique({ where: { id } });
    expect(source?.isEnabled).toBe(true);
    expect(source?.categories).toEqual(["hardware", "mapping"]);
    expect(source?.createdById).toBe(admin.id);
  });

  it("updates a source", async () => {
    const id = await newSource();
    const result = await sourceService.updateSource(id, {
      name: "Renamed source",
      kind: "ATOM",
      feedUrl: "https://feeds.example.test/renamed/atom",
      language: "AR",
      categories: "software",
    });
    expect(result.ok).toBe(true);

    const source = await prisma.contentSource.findUnique({ where: { id } });
    expect(source?.name).toBe("Renamed source");
    expect(source?.kind).toBe("ATOM");
    expect(source?.language).toBe("AR");
  });

  it("disables a source, and a disabled source is never fetched", async () => {
    const id = await newSource();
    await sourceService.setSourceEnabled(id, false);

    const disabled = await prisma.contentSource.findUniqueOrThrow({ where: { id } });
    const requested: string[] = [];
    setFeedFetcherForTesting(async (url) => {
      requested.push(url);
      return okFetch(rssWith([{ id: uid(), slug: uid(), title: "Should not appear" }]));
    });

    // Deliberately the UNSCOPED run — the one a scheduler would make.
    const result = await ingestionService.runIngestion();

    expect(requested).not.toContain(disabled.feedUrl);
    expect(result.sources.every((summary) => summary.sourceId !== id)).toBe(true);
    expect(await prisma.contentItem.count({ where: { sourceId: id } })).toBe(0);
  });

  // --------------------------------------------------- 4–7 URL safety

  it("refuses a source URL on a private address", async () => {
    for (const feedUrl of [
      "http://10.0.0.5/feed.xml",
      "http://192.168.1.10/rss",
      "http://172.16.4.4/rss",
    ]) {
      const result = await sourceService.createSource({
        name: "Bad",
        kind: "RSS",
        feedUrl,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].field).toBe("feedUrl");
    }
  });

  it("refuses localhost and a cloud metadata endpoint", async () => {
    for (const feedUrl of [
      "http://localhost:3000/feed",
      "http://127.0.0.1/feed",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
    ]) {
      const result = await sourceService.createSource({
        name: "Bad",
        kind: "RSS",
        feedUrl,
      });
      expect(result.ok).toBe(false);
    }
    // None of them was stored.
    expect(
      await prisma.contentSource.count({ where: { name: "Bad" } }),
    ).toBe(0);
  });

  it("reports a redirect to a private target as a failed source, ingesting nothing", async () => {
    const id = await newSource();
    setFeedFetcherForTesting(async () => ({
      ok: false,
      code: "REDIRECT_NOT_ALLOWED",
      message: "That website redirected to an address inside a private network.",
    }));

    const result = await ingestionService.runIngestion({ sourceIds: [id] });
    expect(result.status).toBe("FAILED");
    expect(await prisma.contentItem.count({ where: { sourceId: id } })).toBe(0);

    const run = await prisma.contentIngestionRun.findFirst({
      where: { sourceId: id },
      orderBy: [{ startedAt: "desc" }],
    });
    expect(run?.status).toBe("FAILED");
    // Friendly text, and no internal address leaked into the log.
    expect(run?.errorMessage).toMatch(/private network/i);
    expect(run?.errorMessage).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  // ------------------------------------------------ 8–12 ingestion & dedup

  it("ingests an RSS feed as PENDING_REVIEW — never approved", async () => {
    const id = await newSource();
    const result = await ingestInto(
      id,
      rssWith([
        { id: `a-${uid()}`, slug: uid(), title: "First article" },
        { id: `b-${uid()}`, slug: uid(), title: "Second article" },
      ]),
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.totalCreated).toBe(2);

    const items = await prisma.contentItem.findMany({ where: { sourceId: id } });
    expect(items).toHaveLength(2);
    // THE invariant: nothing arrives usable.
    expect(items.every((item) => item.reviewState === "PENDING_REVIEW")).toBe(true);
    expect(items.every((item) => item.origin === "INGESTED")).toBe(true);
  });

  it("ingests an Atom feed", async () => {
    const id = await newSource({ kind: "ATOM" });
    const slug = uid();
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom test</title>
      <entry>
        <title>Atom article</title>
        <link rel="alternate" href="https://feeds.example.test/${slug}"/>
        <id>atom-${slug}</id>
        <summary>Atom excerpt.</summary>
      </entry>
    </feed>`;

    const result = await ingestInto(id, atom);
    expect(result.totalCreated).toBe(1);

    const item = await prisma.contentItem.findFirst({ where: { sourceId: id } });
    expect(item?.title).toBe("Atom article");
    expect(item?.externalUrl).toBe(`https://feeds.example.test/${slug}`);
  });

  it("is idempotent — polling the same feed repeatedly creates one row per article", async () => {
    const id = await newSource();
    const feed = rssWith([{ id: `x-${uid()}`, slug: uid(), title: "Repeated" }]);

    const first = await ingestInto(id, feed);
    const second = await ingestInto(id, feed);
    const third = await ingestInto(id, feed);

    expect(first.totalCreated).toBe(1);
    expect(second.totalCreated).toBe(0);
    expect(third.totalCreated).toBe(0);
    expect(await prisma.contentItem.count({ where: { sourceId: id } })).toBe(1);
  });

  it("does not duplicate the same article behind tracking parameters", async () => {
    const id = await newSource();
    const slug = uid();

    // Same article, no guid, different campaign parameters each time.
    const feedA = `<rss version="2.0"><channel><item>
      <title>Tracked</title><link>https://feeds.example.test/${slug}?utm_source=a</link>
    </item></channel></rss>`;
    const feedB = `<rss version="2.0"><channel><item>
      <title>Tracked</title><link>https://feeds.example.test/${slug}?utm_source=b&amp;fbclid=z</link>
    </item></channel></rss>`;

    await ingestInto(id, feedA);
    const second = await ingestInto(id, feedB);

    expect(second.totalCreated).toBe(0);
    expect(await prisma.contentItem.count({ where: { sourceId: id } })).toBe(1);
  });

  it("does NOT merge different articles with similar titles", async () => {
    const id = await newSource();
    const feed = rssWith([
      { id: `t1-${uid()}`, slug: uid(), title: "New scanner released" },
      { id: `t2-${uid()}`, slug: uid(), title: "New scanner released" },
    ]);

    const result = await ingestInto(id, feed);
    // Same words, different URLs and different ids: two articles, not one.
    expect(result.totalCreated).toBe(2);
    expect(await prisma.contentItem.count({ where: { sourceId: id } })).toBe(2);
  });

  // ------------------------------------------- 13–14 failure isolation

  it("isolates a failing source and reports the batch as PARTIAL", async () => {
    const good = await newSource({ name: `Good ${uid()}` });
    const bad = await newSource({ name: `Bad ${uid()}` });

    setFeedFetcherForTesting(async (url) =>
      url.includes(
        (await prisma.contentSource.findUnique({ where: { id: bad } }))?.feedUrl ?? "@@",
      )
        ? { ok: false, code: "TIMEOUT", message: "That website took too long to answer." }
        : okFetch(rssWith([{ id: `g-${uid()}`, slug: uid(), title: "Good article" }])),
    );

    const result = await ingestionService.runIngestion({ sourceIds: [good, bad] });

    expect(result.status).toBe("PARTIAL");
    expect(result.sources.find((s) => s.sourceId === good)?.status).toBe("SUCCESS");
    expect(result.sources.find((s) => s.sourceId === bad)?.status).toBe("FAILED");
    // The healthy source still delivered.
    expect(await prisma.contentItem.count({ where: { sourceId: good } })).toBe(1);
  });

  it("reports 'nothing new' as an ordinary result, not an error", async () => {
    const id = await newSource();
    const feed = rssWith([{ id: `n-${uid()}`, slug: uid(), title: "Only article" }]);
    await ingestInto(id, feed);

    const second = await ingestInto(id, feed);
    expect(second.status).toBe("SUCCESS");
    expect(second.message).toMatch(/up to date/i);
    expect(second.message).not.toMatch(/error|failed|problem/i);
  });

  // ------------------------------------------- 15–20 review workflow

  const ingestOneItem = async () => {
    const sourceId = await newSource();
    await ingestInto(
      sourceId,
      rssWith([{ id: `r-${uid()}`, slug: uid(), title: `Reviewable ${uid()}` }]),
    );
    const item = await prisma.contentItem.findFirstOrThrow({ where: { sourceId } });
    return { sourceId, item };
  };

  it("moves an item from waiting to APPROVED, naming the reviewer", async () => {
    const { item } = await ingestOneItem();

    const result = await reviewService.approveContent(item.id);
    expect(result.ok).toBe(true);

    const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.reviewState).toBe("APPROVED");
    expect(after.reviewedById).toBe(admin.id);
    expect(after.reviewedAt).not.toBeNull();
  });

  it("moves an item to REJECTED", async () => {
    const { item } = await ingestOneItem();
    await reviewService.rejectContent(item.id);
    const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.reviewState).toBe("REJECTED");
  });

  it("keeps rejected content out of a draft, even when its id is supplied directly", async () => {
    const { item } = await ingestOneItem();
    await reviewService.rejectContent(item.id);

    const result = await draftService.createDraftFromContent({
      contentItemIds: [item.id],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NONE_APPROVED");
  });

  it("keeps UNREVIEWED content out of a draft", async () => {
    const { item } = await ingestOneItem();
    // Straight from ingestion — never touched by a person.
    const result = await draftService.createDraftFromContent({
      contentItemIds: [item.id],
    });
    expect(result.ok).toBe(false);
  });

  it("preserves the original source metadata when AXIS editorial copy is written", async () => {
    const { item } = await ingestOneItem();

    await reviewService.saveEditorial(item.id, {
      axisHeadline: "AXIS take on this",
      axisSummary: "Why this matters to AXIS customers.",
      ctaLabel: "Read more",
      ctaUrl: "https://example.com/product",
      internalNote: "Mention at the sales meeting.",
    });

    const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    // The publisher's fields are untouched...
    expect(after.title).toBe(item.title);
    expect(after.summary).toBe(item.summary);
    expect(after.externalUrl).toBe(item.externalUrl);
    expect(after.publishedAt?.toISOString()).toBe(item.publishedAt?.toISOString());
    // ...and AXIS's words live in their own columns.
    expect(after.axisHeadline).toBe("AXIS take on this");
    expect(after.internalNote).toBe("Mention at the sales meeting.");
    // Saving editorial copy is not a review decision.
    expect(after.reviewState).toBe("PENDING_REVIEW");
  });

  it("refuses a CTA that points anywhere private", async () => {
    const { item } = await ingestOneItem();
    const result = await reviewService.saveEditorial(item.id, {
      ctaLabel: "Click",
      ctaUrl: "http://169.254.169.254/",
    });
    expect(result.ok).toBe(false);

    const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.ctaUrl).toBeNull();
  });

  it("re-ingestion never overwrites AXIS editorial copy", async () => {
    const sourceId = await newSource();
    const guid = `keep-${uid()}`;
    const slug = uid();
    const feed = rssWith([{ id: guid, slug, title: "Original title" }]);

    await ingestInto(sourceId, feed);
    const item = await prisma.contentItem.findFirstOrThrow({ where: { sourceId } });
    await reviewService.saveEditorial(item.id, { axisHeadline: "AXIS words" });

    await ingestInto(sourceId, feed);

    const after = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.axisHeadline).toBe("AXIS words");
  });

  // ------------------------------------------- 21–27 draft creation

  const approvedItems = async (count: number) => {
    const sourceId = await newSource();
    await ingestInto(
      sourceId,
      rssWith(
        Array.from({ length: count }, (_, index) => ({
          id: `d${index}-${uid()}`,
          slug: uid(),
          title: `Article ${index + 1} ${uid()}`,
        })),
      ),
    );
    const items = await prisma.contentItem.findMany({
      where: { sourceId },
      orderBy: [{ createdAt: "asc" }],
    });
    for (const item of items) await reviewService.approveContent(item.id);
    return { sourceId, items };
  };

  it("creates a multi-item DRAFT newsletter from approved articles", async () => {
    const { items } = await approvedItems(3);

    const result = await draftService.createDraftFromContent({
      contentItemIds: items.map((item) => item.id),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    created.campaign.push(result.campaignId);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId },
      include: { contentLinks: { orderBy: { position: "asc" } } },
    });

    expect(campaign.status).toBe("DRAFT");
    expect(campaign.contentLinks).toHaveLength(3);
  });

  it("preserves the chosen order, and the FIRST item stays the hero", async () => {
    const { items } = await approvedItems(3);
    // Deliberately not the natural order.
    const chosen = [items[2].id, items[0].id, items[1].id];

    const result = await draftService.createDraftFromContent({ contentItemIds: chosen });
    if (!result.ok) throw new Error(result.message);
    created.campaign.push(result.campaignId);

    const links = await prisma.campaignContentItem.findMany({
      where: { campaignId: result.campaignId },
      orderBy: { position: "asc" },
    });

    expect(links.map((link) => link.contentItemId)).toEqual(chosen);
    // The renderer treats position 0 as the featured article (ADR-0015).
    expect(links[0].position).toBe(0);
    expect(links[0].contentItemId).toBe(items[2].id);
  });

  it("chooses NO segment and prepares NO audience", async () => {
    const { items } = await approvedItems(1);
    const result = await draftService.createDraftFromContent({
      contentItemIds: [items[0].id],
    });
    if (!result.ok) throw new Error(result.message);
    created.campaign.push(result.campaignId);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId },
    });
    expect(campaign.segmentId).toBeNull();

    const [snapshots, finalAudiences, approvals] = await Promise.all([
      prisma.campaignAudienceSnapshot.count({ where: { campaignId: result.campaignId } }),
      prisma.campaignFinalAudience.count({ where: { campaignId: result.campaignId } }),
      prisma.campaignProductionApproval.count({ where: { campaignId: result.campaignId } }),
    ]);
    expect(snapshots).toBe(0);
    expect(finalAudiences).toBe(0);
    expect(approvals).toBe(0);
  });

  it("creates NO CampaignRecipient and NO CampaignEvent", async () => {
    const { items } = await approvedItems(1);
    const result = await draftService.createDraftFromContent({
      contentItemIds: [items[0].id],
    });
    if (!result.ok) throw new Error(result.message);
    created.campaign.push(result.campaignId);

    expect(
      await prisma.campaignRecipient.count({ where: { campaignId: result.campaignId } }),
    ).toBe(0);
    expect(
      await prisma.campaignEvent.count({ where: { campaignId: result.campaignId } }),
    ).toBe(0);
    expect(
      await prisma.campaignTestSend.count({ where: { campaignId: result.campaignId } }),
    ).toBe(0);
  });

  it("silently skips unapproved ids in a mixed selection, and says so", async () => {
    const { items } = await approvedItems(2);
    const { item: unreviewed } = await ingestOneItem();

    const result = await draftService.createDraftFromContent({
      contentItemIds: [items[0].id, unreviewed.id, items[1].id],
    });
    if (!result.ok) throw new Error(result.message);
    created.campaign.push(result.campaignId);

    expect(result.attached).toBe(2);
    expect(result.message).toMatch(/not approved/i);
  });

  // ------------------------------------------- 28–35 automation

  const newAutomation = async (
    overrides: Partial<automationService.AutomationInput> = {},
  ) => {
    const result = await automationService.createAutomation({
      name: `Automation ${uid()}`,
      cadence: "WEEKLY",
      interval: 1,
      dayOfWeek: 1,
      hour: 8,
      language: "HE",
      maxItems: 5,
      ...overrides,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    created.automation.push(result.data.id);
    return result.data.id;
  };

  it("creates a WEEKLY automation with a computed next occurrence", async () => {
    const id = await newAutomation();
    const automation = await prisma.newsletterAutomation.findUniqueOrThrow({
      where: { id },
    });
    expect(automation.cadence).toBe("WEEKLY");
    expect(automation.mode).toBe("ASSISTED");
    expect(automation.nextScheduledAt).not.toBeNull();
    expect(automation.nextScheduledAt!.getUTCDay()).toBe(1);
    // An automation never picks an audience.
    expect(automation.segmentId).toBeNull();
  });

  it("creates a MONTHLY automation", async () => {
    const id = await newAutomation({ cadence: "MONTHLY", dayOfMonth: 1, dayOfWeek: null });
    const automation = await prisma.newsletterAutomation.findUniqueOrThrow({
      where: { id },
    });
    expect(automation.cadence).toBe("MONTHLY");
    expect(automation.nextScheduledAt?.getUTCDate()).toBe(1);
  });

  it("runs an occurrence exactly once, however many times it is asked", async () => {
    const sourceId = await newSource();
    const id = await newAutomation({ sourceIds: [sourceId] });
    setFeedFetcherForTesting(async () => okFetch(rssWith([])));

    const scheduledFor = new Date("2026-08-10T08:00:00.000Z");
    const [a, b, c] = await Promise.all([
      automationService.runAutomation(id, { scheduledFor }),
      automationService.runAutomation(id, { scheduledFor }),
      automationService.runAutomation(id, { scheduledFor }),
    ]);

    const skipped = [a, b, c].filter((run) => run.status === "SKIPPED");
    expect(skipped).toHaveLength(2);
    expect(
      await prisma.newsletterAutomationRun.count({
        where: { automationId: id, scheduledFor },
      }),
    ).toBe(1);
  });

  it("does not run while paused — no fetch, no run row, no draft", async () => {
    const id = await newAutomation();
    await automationService.setAutomationEnabled(id, false);

    let fetched = 0;
    setFeedFetcherForTesting(async () => {
      fetched += 1;
      return okFetch(rssWith([]));
    });

    const result = await automationService.runAutomation(id);

    expect(result.status).toBe("SKIPPED");
    expect(fetched).toBe(0);
    expect(await prisma.newsletterAutomationRun.count({ where: { automationId: id } })).toBe(0);

    const automation = await prisma.newsletterAutomation.findUniqueOrThrow({ where: { id } });
    // A paused automation carries no next occurrence.
    expect(automation.nextScheduledAt).toBeNull();
  });

  it("reports NO_CONTENT — not an error — when nothing approved is waiting", async () => {
    const sourceId = await newSource();
    const id = await newAutomation({ sourceIds: [sourceId] });

    // Fresh articles arrive, but nobody has approved them.
    setFeedFetcherForTesting(async () =>
      okFetch(rssWith([{ id: `u-${uid()}`, slug: uid(), title: "Unreviewed" }])),
    );

    const result = await automationService.runAutomation(id);

    expect(result.status).toBe("NO_CONTENT");
    expect(result.campaignId).toBeNull();
    expect(result.itemsNew).toBe(1);
    expect(result.message).toMatch(/review inbox/i);
    expect(result.message).not.toMatch(/error|failed/i);
  });

  it("drafts ONLY from content a person already approved", async () => {
    const sourceId = await newSource();
    await ingestInto(
      sourceId,
      rssWith([
        { id: `ok-${uid()}`, slug: uid(), title: "Approved one" },
        { id: `no-${uid()}`, slug: uid(), title: "Left waiting" },
      ]),
    );
    const items = await prisma.contentItem.findMany({
      where: { sourceId },
      orderBy: [{ createdAt: "asc" }],
    });
    await reviewService.approveContent(items[0].id);

    const id = await newAutomation({ sourceIds: [sourceId] });
    setFeedFetcherForTesting(async () => okFetch(rssWith([])));

    const result = await automationService.runAutomation(id);
    expect(result.status).toBe("PREPARED");
    expect(result.itemsUsed).toBe(1);
    if (result.campaignId) created.campaign.push(result.campaignId);

    const links = await prisma.campaignContentItem.findMany({
      where: { campaignId: result.campaignId! },
    });
    expect(links.map((link) => link.contentItemId)).toEqual([items[0].id]);
  });

  it("records run history with counts and the draft it produced", async () => {
    const sourceId = await newSource();
    await ingestInto(
      sourceId,
      rssWith([{ id: `h-${uid()}`, slug: uid(), title: "Historic" }]),
    );
    const item = await prisma.contentItem.findFirstOrThrow({ where: { sourceId } });
    await reviewService.approveContent(item.id);

    const id = await newAutomation({ sourceIds: [sourceId] });
    setFeedFetcherForTesting(async () => okFetch(rssWith([])));
    const result = await automationService.runAutomation(id);
    if (result.campaignId) created.campaign.push(result.campaignId);

    const runs = await automationService.listRuns(id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PREPARED");
    expect(runs[0].itemsUsed).toBe(1);
    expect(runs[0].generatedCampaignId).toBe(result.campaignId);
    expect(runs[0].completedAt).not.toBeNull();

    const automation = await prisma.newsletterAutomation.findUniqueOrThrow({ where: { id } });
    expect(automation.lastRunAt).not.toBeNull();
    expect(automation.nextScheduledAt).not.toBeNull();
  });

  it("an automation run creates NO recipients and sends nothing", async () => {
    const sourceId = await newSource();
    await ingestInto(sourceId, rssWith([{ id: `s-${uid()}`, slug: uid(), title: "Safe" }]));
    const item = await prisma.contentItem.findFirstOrThrow({ where: { sourceId } });
    await reviewService.approveContent(item.id);

    const before = await prisma.campaignRecipient.count();

    const id = await newAutomation({ sourceIds: [sourceId] });
    setFeedFetcherForTesting(async () => okFetch(rssWith([])));
    const result = await automationService.runAutomation(id);
    if (result.campaignId) created.campaign.push(result.campaignId);

    // Globally unchanged: the automation added no delivery row anywhere.
    expect(await prisma.campaignRecipient.count()).toBe(before);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId! },
    });
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.sendMode).toBe("TEST");
    expect(campaign.sentAt).toBeNull();
  });

  // ------------------------------------------- 36–38 auth and audit

  it("requires authentication", async () => {
    actAsNobody();
    await expect(ingestionService.runIngestion()).rejects.toThrow();
    await expect(reviewService.listInbox()).rejects.toThrow();
    await expect(
      draftService.createDraftFromContent({ contentItemIds: ["x"] }),
    ).rejects.toThrow();
    await expect(sourceService.listSources()).rejects.toThrow();
  });

  it("refuses source management to a MANAGER, and allows review", async () => {
    actAs(manager);

    // Supplying a URL the server will fetch is an ADMIN act (ADR-0026).
    await expect(
      sourceService.createSource({
        name: "Manager attempt",
        kind: "RSS",
        feedUrl: "https://feeds.example.test/manager/rss",
      }),
    ).rejects.toThrow(/permission/i);

    // Editorial work is ordinary manager work.
    await expect(reviewService.listInbox()).resolves.toBeDefined();
    await expect(reviewService.countInbox()).resolves.toBeDefined();
  });

  it("writes audit rows naming the real actor", async () => {
    const sourceId = await newSource();
    await sourceService.setSourceEnabled(sourceId, false);
    await sourceService.setSourceEnabled(sourceId, true);

    const { item } = await ingestOneItem();
    await reviewService.approveContent(item.id);

    const sourceAudit = await prisma.auditLog.findMany({
      where: { entityId: sourceId },
      select: { action: true, actorUserId: true },
    });
    const actions = sourceAudit.map((row) => row.action);
    expect(actions).toContain("CONTENT_SOURCE_CREATED");
    expect(actions).toContain("CONTENT_SOURCE_DISABLED");
    expect(actions).toContain("CONTENT_SOURCE_ENABLED");
    expect(sourceAudit.every((row) => row.actorUserId === admin.id)).toBe(true);

    const contentAudit = await prisma.auditLog.findFirst({
      where: { entityId: item.id, action: "CONTENT_APPROVED" },
    });
    expect(contentAudit?.actorUserId).toBe(admin.id);
    // The article's text is not copied into the audit trail.
    expect(JSON.stringify(contentAudit?.metadata)).not.toContain("Excerpt for");
  });

  // ------------------------------------------- structural guarantees

  it("the automation service cannot reach a provider, dispatch, or a recipient", () => {
    const code = readFileSync(
      new URL("../../src/server/services/automationService.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const forbidden of [
      "getEmailProvider",
      "getProductionEmailProvider",
      "dispatchCampaign",
      "sendApproved",
      "campaignRecipient",
      "prepareDeliveryLedger",
      "nodemailer",
      "resend",
    ]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("no live email provider can be constructed under the test runner", async () => {
    // A developer machine legitimately holds real Gmail and Resend credentials in
    // .env.local, and the suite reads the same environment. The registry must be
    // INCAPABLE of handing out a network-capable adapter here, not merely unlikely to.
    const email = await import("../../src/server/integrations/email");

    expect(email.liveProvidersPermitted()).toBe(false);

    email.setEmailProviderForTesting(undefined);
    email.setProductionEmailProviderForTesting(undefined);

    expect(email.getProductionEmailProvider().name).toBe("DISABLED");
    expect(email.getEmailProvider().checkConfiguration().configured).toBe(false);

    await expect(
      email.getEmailProvider().sendTestEmail({
        to: "khaled-s@axis-gps.com",
        subject: "x",
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/attempted to send a real email/i);
  });

  it("the ingestion service fetches only through the guarded fetcher", () => {
    const code = readFileSync(
      new URL("../../src/server/services/contentIngestionService.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // No bare fetch: every request goes through the SSRF-guarded boundary.
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).toContain("getFeedFetcher");
  });
});
