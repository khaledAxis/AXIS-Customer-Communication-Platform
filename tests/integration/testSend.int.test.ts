import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

import { getPrisma } from "../../src/server/db/prisma";
import { FakeEmailProvider } from "../../src/server/integrations/email/fakeEmailProvider";
import { setEmailProviderForTesting } from "../../src/server/integrations/email";
import * as contentService from "../../src/server/services/contentService";
import * as newsletterService from "../../src/server/services/newsletterService";
import * as testSendService from "../../src/server/services/testSendService";

/**
 * SAFE TEST send workflow against real PostgreSQL, with a FAKE provider.
 *
 * No test can reach Microsoft Graph: the provider is replaced for the whole suite and
 * restored afterwards. These tests cover the approval hash, single use, DB-enforced
 * idempotency, and that production ledgers stay untouched.
 *
 * Repeatable: run-scoped values, scoped cleanup, no table truncation.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
let seq = 0;
const uid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = { campaign: [] as string[], contentItem: [] as string[] };

d("SAFE TEST send", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let provider: FakeEmailProvider;

  const newApprovedArticle = async (title = `Article ${uid()}`) => {
    const result = await contentService.createContent({
      title,
      summary: "Summary",
      body: "Body **text**",
      language: "HE",
      origin: "INTERNAL",
    });
    if (!result.ok) throw new Error("fixture failed");
    created.contentItem.push(result.data.id);
    await contentService.setReviewState(result.data.id, "APPROVED");
    return result.data;
  };

  /** A newsletter with one article — the minimum that can be approved. */
  const newSendableNewsletter = async () => {
    const result = await newsletterService.createNewsletter({
      name: `NL ${uid()}`,
      subject: `Subject ${uid()}`,
      language: "HE",
    });
    if (!result.ok) throw new Error("fixture failed");
    created.campaign.push(result.data.id);
    const article = await newApprovedArticle();
    await newsletterService.addContent(result.data.id, article.id);
    return { campaignId: result.data.id, article };
  };

  beforeAll(async () => {
    prisma = getPrisma();
    await prisma.$connect();
  });

  afterEach(() => {
    provider = new FakeEmailProvider();
    setEmailProviderForTesting(provider);
  });

  afterAll(async () => {
    setEmailProviderForTesting(undefined); // never leave a fake installed
    try {
      await prisma.campaignTestSend.deleteMany({ where: { campaignId: { in: created.campaign } } });
      await prisma.campaignTestApproval.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: created.campaign } } });
      await prisma.campaignContentItem.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.campaign.deleteMany({ where: { id: { in: created.campaign } } });
      await prisma.contentItem.deleteMany({ where: { id: { in: created.contentItem } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  // Installed for the first test too (afterEach only runs between tests).
  const install = (p: FakeEmailProvider) => {
    provider = p;
    setEmailProviderForTesting(p);
  };

  // ------------------------------------------------------------- availability

  it("reports unavailable when the provider is not configured", async () => {
    install(new FakeEmailProvider({ configured: false, problems: ["No credentials."] }));
    const { campaignId } = await newSendableNewsletter();

    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status!.providerConfigured).toBe(false);
    expect(status!.canSend).toBe(false);
    expect(status!.message).toBe("Microsoft email provider is not configured");
  });

  it("still allows approving while the provider is unconfigured", async () => {
    install(new FakeEmailProvider({ configured: false }));
    const { campaignId } = await newSendableNewsletter();
    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status!.canApprove).toBe(true);
  });

  it("cannot send without an approval", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(provider.callCount).toBe(0);
  });

  it("refuses to approve a newsletter with no articles", async () => {
    install(new FakeEmailProvider());
    const created2 = await newsletterService.createNewsletter({
      name: `Empty ${uid()}`,
      subject: `S ${uid()}`,
      language: "HE",
    });
    if (!created2.ok) throw new Error("fixture failed");
    created.campaign.push(created2.data.id);

    const result = await testSendService.approveTestSend(created2.data.id);
    expect(result.ok).toBe(false);
  });

  // ----------------------------------------------------------------- approval

  it("approves, then sends exactly one email", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();

    expect((await testSendService.approveTestSend(campaignId)).ok).toBe(true);

    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status!.canSend).toBe(true);
    expect(status!.approval?.valid).toBe(true);

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(true);
    expect(provider.callCount).toBe(1);
    expect(provider.sent[0].to).toBe("khaled-s@axis-gps.com");
    expect(provider.sent[0].subject).toContain("[AXIS TEST]");
  });

  it("records the approval with the exact rendered content hash", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const rendered = await testSendService.renderTestEmail(campaignId);
    const approval = await prisma.campaignTestApproval.findFirst({ where: { campaignId } });

    expect(approval!.contentHash).toBe(rendered!.contentHash);
    expect(approval!.fromEmail).toBe("fahed@axis-gps.com");
    expect(approval!.toEmail).toBe("khaled-s@axis-gps.com");
    expect(approval!.sendMode).toBe("TEST");
  });

  it("writes an audit record for the approval", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: campaignId, action: "TEST_SEND_APPROVED" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/secret|token|Bearer/i);
  });

  // --------------------------------------------------------- invalidation

  it.each([
    [
      "the subject changes",
      async (campaignId: string) => {
        const campaign = await newsletterService.getNewsletter(campaignId);
        await newsletterService.updateNewsletterDetails(campaignId, {
          name: campaign!.name,
          subject: `Changed ${uid()}`,
          language: campaign!.language,
        });
      },
    ],
    [
      "the preview text changes",
      async (campaignId: string) => {
        const campaign = await newsletterService.getNewsletter(campaignId);
        await newsletterService.updateNewsletterDetails(campaignId, {
          name: campaign!.name,
          subject: campaign!.subject ?? "s",
          preheader: `Changed ${uid()}`,
          language: campaign!.language,
        });
      },
    ],
    [
      "an article is added",
      async (campaignId: string) => {
        const extra = await newApprovedArticle();
        await newsletterService.addContent(campaignId, extra.id);
      },
    ],
    [
      "an article body is edited",
      async (campaignId: string) => {
        const campaign = await newsletterService.getNewsletter(campaignId);
        const item = campaign!.contentLinks[0].contentItem;
        await contentService.updateContent(item.id, {
          title: item.title,
          language: item.language,
          body: `Edited ${uid()}`,
        });
      },
    ],
    [
      "an article image changes",
      async (campaignId: string) => {
        const campaign = await newsletterService.getNewsletter(campaignId);
        const item = campaign!.contentLinks[0].contentItem;
        await contentService.updateContent(item.id, {
          title: item.title,
          language: item.language,
          imageUrl: `/api/media/pic-${uid()}.png`,
        });
      },
    ],
    [
      "the language changes",
      async (campaignId: string) => {
        const campaign = await newsletterService.getNewsletter(campaignId);
        await newsletterService.updateNewsletterDetails(campaignId, {
          name: campaign!.name,
          subject: campaign!.subject ?? "s",
          language: "AR",
        });
      },
    ],
  ])("invalidates the approval when %s", async (_label, mutate) => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    await mutate(campaignId);

    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status!.canSend).toBe(false);
    expect(status!.approval?.reason).toBe("CONTENT_CHANGED");

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Newsletter changed after approval. Please review and approve again.");
    expect(provider.callCount).toBe(0);
  });

  it("invalidates the approval when articles are reordered", async () => {
    install(new FakeEmailProvider());
    const { campaignId, article } = await newSendableNewsletter();
    const second = await newApprovedArticle();
    await newsletterService.addContent(campaignId, second.id);

    await testSendService.approveTestSend(campaignId);
    await newsletterService.reorderContent(campaignId, [second.id, article.id]);

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("CONTENT_CHANGED");
    expect(provider.callCount).toBe(0);
  });

  it("can be re-approved after a change and then sends", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const campaign = await newsletterService.getNewsletter(campaignId);
    await newsletterService.updateNewsletterDetails(campaignId, {
      name: campaign!.name,
      subject: `New subject ${uid()}`,
      language: campaign!.language,
    });

    expect((await testSendService.sendApprovedTestEmail(campaignId)).ok).toBe(false);
    expect((await testSendService.approveTestSend(campaignId)).ok).toBe(true);
    expect((await testSendService.sendApprovedTestEmail(campaignId)).ok).toBe(true);
    expect(provider.callCount).toBe(1);
  });

  // ------------------------------------------------------- single use / idempotency

  it("consumes the approval so a second send is refused", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    expect((await testSendService.sendApprovedTestEmail(campaignId)).ok).toBe(true);

    const second = await testSendService.sendApprovedTestEmail(campaignId);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("ALREADY_USED");
    expect(provider.callCount).toBe(1);
  });

  it("a double click produces at most ONE provider submission", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const [a, b] = await Promise.all([
      testSendService.sendApprovedTestEmail(campaignId),
      testSendService.sendApprovedTestEmail(campaignId),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(provider.callCount).toBe(1);
  });

  it("five concurrent submissions still produce ONE provider call", async () => {
    // The DB unique constraint on CampaignTestSend.approvalId is the real guard here.
    install(new FakeEmailProvider({ onSend: () => new Promise((r) => setTimeout(r, 20)) }));
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => testSendService.sendApprovedTestEmail(campaignId)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(provider.callCount).toBe(1);
    expect(await prisma.campaignTestSend.count({ where: { campaignId } })).toBe(1);
  });

  it("approving again revokes the previous unused approval", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await testSendService.approveTestSend(campaignId);

    const approvals = await prisma.campaignTestApproval.findMany({ where: { campaignId } });
    expect(approvals).toHaveLength(2);
    expect(approvals.filter((a) => a.revokedAt === null)).toHaveLength(1);
  });

  it("a withdrawn approval cannot send", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await testSendService.revokeTestApprovals(campaignId);

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(provider.callCount).toBe(0);
  });

  // --------------------------------------------------------------- ledger

  it("records an ACCEPTED attempt with provider metadata and no secrets", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await testSendService.sendApprovedTestEmail(campaignId);

    const attempt = await prisma.campaignTestSend.findFirst({ where: { campaignId } });
    expect(attempt!.state).toBe("ACCEPTED");
    expect(attempt!.provider).toBe("MICROSOFT_GRAPH");
    expect(attempt!.fromEmail).toBe("fahed@axis-gps.com");
    expect(attempt!.toEmail).toBe("khaled-s@axis-gps.com");
    expect(attempt!.providerStatusCode).toBe(202);
    expect(attempt!.acceptedAt).not.toBeNull();
    expect(attempt!.idempotencyKey).not.toBeNull();
    expect(attempt!.approvalId).not.toBeNull();
    expect(JSON.stringify(attempt)).not.toMatch(/Bearer|access_token|client_secret/i);
  });

  it("records a FAILED attempt without accepting it", async () => {
    install(
      new FakeEmailProvider({
        result: {
          outcome: "FAILED",
          statusCode: 403,
          failureCode: "GRAPH_FORBIDDEN",
          message: "Microsoft refused the send.",
        },
      }),
    );
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);

    const attempt = await prisma.campaignTestSend.findFirst({ where: { campaignId } });
    expect(attempt!.state).toBe("FAILED");
    expect(attempt!.failureCode).toBe("GRAPH_FORBIDDEN");
    expect(attempt!.acceptedAt).toBeNull();
  });

  it("records an UNCERTAIN attempt and never auto-retries it", async () => {
    install(
      new FakeEmailProvider({
        result: {
          outcome: "UNCERTAIN",
          failureCode: "NETWORK_OR_TIMEOUT",
          message: "Connection failed before a reply arrived.",
        },
      }),
    );
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("UNCERTAIN");

    const attempt = await prisma.campaignTestSend.findFirst({ where: { campaignId } });
    expect(attempt!.state).toBe("UNCERTAIN");

    // The approval stays consumed: re-sending could duplicate a message Microsoft
    // may already have accepted.
    const retry = await testSendService.sendApprovedTestEmail(campaignId);
    expect(retry.ok).toBe(false);
    expect(provider.callCount).toBe(1);
  });

  // ------------------------------------------------- production ledgers untouched

  it("never creates production recipients or campaign events", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await testSendService.sendApprovedTestEmail(campaignId);

    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(0);
    expect(await prisma.campaignEvent.count({ where: { campaignId } })).toBe(0);
    expect(await prisma.campaignRecipientSource.count()).toBe(0);
    // Only the test ledger records the test.
    expect(await prisma.campaignTestSend.count({ where: { campaignId } })).toBe(1);
  });

  it("leaves the campaign in TEST mode and DRAFT throughout", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await testSendService.sendApprovedTestEmail(campaignId);

    const campaign = await newsletterService.getNewsletter(campaignId);
    expect(campaign!.sendMode).toBe("TEST");
    expect(campaign!.status).toBe("DRAFT");
  });

  it("refuses to send when the campaign is not in TEST mode", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    await testSendService.approveTestSend(campaignId);
    await prisma.campaign.update({ where: { id: campaignId }, data: { sendMode: "PRODUCTION" } });

    const result = await testSendService.sendApprovedTestEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NOT_TEST_MODE");
    expect(provider.callCount).toBe(0);

    await prisma.campaign.update({ where: { id: campaignId }, data: { sendMode: "TEST" } });
  });

  // --------------------------------------------------------- preview == sent

  it("submits exactly the HTML shown in the preview", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();

    const preview = await newsletterService.getNewsletterPreview(campaignId);
    await testSendService.approveTestSend(campaignId);
    await testSendService.sendApprovedTestEmail(campaignId);

    expect(provider.sent[0].html).toBe(preview!.html);
    expect(provider.sent[0].subject).toBe(preview!.document.subject);
  });

  it("shows the [AXIS TEST] marker in the preview subject, exactly once", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    const preview = await newsletterService.getNewsletterPreview(campaignId);

    expect(preview!.document.subject.startsWith("[AXIS TEST]")).toBe(true);
    expect(preview!.document.subject.match(/\[AXIS TEST\]/g)).toHaveLength(1);
  });

  it("reports local-only images so nobody expects them in Outlook", async () => {
    install(new FakeEmailProvider());
    const { campaignId } = await newSendableNewsletter();
    const campaign = await newsletterService.getNewsletter(campaignId);
    const item = campaign!.contentLinks[0].contentItem;
    await contentService.updateContent(item.id, {
      title: item.title,
      language: item.language,
      imageUrl: `/api/media/pic-${uid()}.png`,
    });

    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status!.hasLocalOnlyImages).toBe(true);
  });
});
