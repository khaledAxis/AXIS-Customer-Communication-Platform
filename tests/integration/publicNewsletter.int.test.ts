import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPrisma } from "../../src/server/db/prisma";
import * as contentService from "../../src/server/services/contentService";
import * as newsletterService from "../../src/server/services/newsletterService";
import * as publicNewsletter from "../../src/server/services/publicNewsletterService";
import {
  actAs,
  actAsNobody,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * The hosted web version of a newsletter (ADR-0032).
 *
 * Two claims under test:
 *
 *  1. It is genuinely PUBLIC — resolving a token needs no session at all, because a
 *     recipient has no AXIS account.
 *  2. It leaks NOTHING beyond the newsletter — no status, no audience, no recipients,
 *     no campaign id, and no answer to "which newsletters exist?".
 */

const HAS_DB = !!process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const TAG = `pubnl-${randomUUID().slice(0, 8)}`;

d("public newsletter web version", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let manager: TestUser;
  let campaignId: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    manager = await createTestUser({ prefix: "pubnl", role: "MANAGER" });
    actAs(manager);
    prisma = getPrisma();
    await prisma.$connect();

    savedEnv.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL;
    // A publicly reachable origin, so a URL can actually be produced.
    process.env.PUBLIC_APP_URL = "https://mail.axis-gps.com";

    const article = await contentService.createContent({
      title: `${TAG} article`,
      summary: "Synthetic summary for the public page test.",
      language: "HE",
      origin: "INTERNAL",
    });
    if (!article.ok) throw new Error("fixture failed");
    await contentService.setReviewState(article.data.id, "APPROVED");

    const campaign = await newsletterService.createNewsletter({
      name: `${TAG} newsletter`,
      subject: `${TAG} subject line`,
      language: "HE",
    });
    if (!campaign.ok) throw new Error("fixture failed");
    campaignId = campaign.data.id;
    await newsletterService.addContent(campaignId, article.data.id);
  });

  beforeEach(() => actAs(manager));

  afterAll(async () => {
    clearTestActor();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await prisma.campaignContentItem.deleteMany({ where: { campaignId } });
      await prisma.auditLog.deleteMany({ where: { entityId: campaignId } });
      await prisma.campaign.deleteMany({ where: { id: campaignId } });
      await prisma.contentItem.deleteMany({ where: { title: { contains: TAG } } });
      await prisma.user.deleteMany({ where: { id: manager.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("has no web version, and therefore no link, until one is created", async () => {
    expect(await publicNewsletter.publicUrlForCampaign(campaignId)).toBeNull();

    const preview = await newsletterService.getNewsletterPreview(campaignId);
    // The email hides the row rather than shipping a dead link.
    expect(preview?.document.viewInBrowserUrl ?? null).toBeNull();
    expect(preview?.html).not.toContain("/n/");
  });

  it("creates a web version and puts a REAL per-newsletter link in the email", async () => {
    const result = await publicNewsletter.enablePublicPage(campaignId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.url).toMatch(/^https:\/\/mail\.axis-gps\.com\/n\/[A-Za-z0-9_-]{16,}$/);

    const preview = await newsletterService.getNewsletterPreview(campaignId);
    expect(preview?.document.viewInBrowserUrl).toBe(result.url);
    expect(preview?.html).toContain(result.url!);
  });

  it("is idempotent — the URL in an already-sent email keeps working", async () => {
    const first = await publicNewsletter.enablePublicPage(campaignId);
    const second = await publicNewsletter.enablePublicPage(campaignId);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.url).toBe(first.url);
  });

  it("renders the SAME newsletter on the public page as in the email", async () => {
    const result = await publicNewsletter.enablePublicPage(campaignId);
    if (!result.ok) throw new Error("enable failed");

    const page = await publicNewsletter.getPublicNewsletter(result.token);
    expect(page).not.toBeNull();
    expect(page!.subject).toContain(TAG);
    // The article a recipient would see is on the page.
    expect(page!.html).toContain(`${TAG} article`);
    expect(page!.html).toContain("Synthetic summary");
  });

  it("requires NO authentication", async () => {
    const result = await publicNewsletter.enablePublicPage(campaignId);
    if (!result.ok) throw new Error("enable failed");

    // A recipient has no session, and never will.
    actAsNobody();
    const page = await publicNewsletter.getPublicNewsletter(result.token);
    expect(page).not.toBeNull();
    expect(page!.html).toContain(`${TAG} article`);
  });

  it("exposes no admin-only data", async () => {
    const result = await publicNewsletter.enablePublicPage(campaignId);
    if (!result.ok) throw new Error("enable failed");

    actAsNobody();
    const page = await publicNewsletter.getPublicNewsletter(result.token);
    const html = page!.html;

    // No identifiers, no internal state, no audience information.
    expect(html).not.toContain(campaignId);
    expect(html).not.toMatch(/DRAFT|PENDING_APPROVAL|SCHEDULED|SENDING/);
    expect(html).not.toMatch(/recipient|audience|segment/i);
    expect(html).not.toContain(manager.email);
    // And never the internal TEST banner.
    expect(html).not.toMatch(/מצב בדיקה|TEST MODE/i);
  });

  it("refuses a malformed, unknown or tampered token identically", async () => {
    const result = await publicNewsletter.enablePublicPage(campaignId);
    if (!result.ok) throw new Error("enable failed");

    for (const token of [
      "not-a-real-token-value",
      "../../etc/passwd",
      "short",
      "",
      null,
      undefined,
      `${result.token}x`, // one character changed
    ]) {
      // Every failure is the same answer, so the route is never an oracle.
      expect(await publicNewsletter.getPublicNewsletter(token)).toBeNull();
    }
  });

  it("turning the web version off makes the old URL stop resolving", async () => {
    const enabled = await publicNewsletter.enablePublicPage(campaignId);
    if (!enabled.ok) throw new Error("enable failed");

    await publicNewsletter.disablePublicPage(campaignId);

    expect(await publicNewsletter.getPublicNewsletter(enabled.token)).toBeNull();
    expect(await publicNewsletter.publicUrlForCampaign(campaignId)).toBeNull();

    const preview = await newsletterService.getNewsletterPreview(campaignId);
    expect(preview?.document.viewInBrowserUrl ?? null).toBeNull();
  });

  it("hides the link when the configured origin is not publicly reachable", async () => {
    await publicNewsletter.enablePublicPage(campaignId);
    process.env.PUBLIC_APP_URL = "http://localhost:3000";
    try {
      // The page still exists; the LINK does not, because it would be dead in an inbox.
      expect(await publicNewsletter.publicUrlForCampaign(campaignId)).toBeNull();
      const preview = await newsletterService.getNewsletterPreview(campaignId);
      expect(preview?.html).not.toContain("localhost");
    } finally {
      process.env.PUBLIC_APP_URL = "https://mail.axis-gps.com";
    }
  });

  it("reports existence and reachability separately", async () => {
    // Three states, not two. A web version can exist while the configured origin is
    // one no recipient could reach — collapsing that into "no web version yet" tells
    // an operator something false about their own data.
    await publicNewsletter.disablePublicPage(campaignId);
    const before = await publicNewsletter.getPublicPageState(campaignId);
    expect(before).toEqual({ enabled: false, emailUrl: null, inspectUrl: null });

    const created = await publicNewsletter.enablePublicPage(campaignId);
    if (!created.ok) throw new Error("enable failed");

    const reachable = await publicNewsletter.getPublicPageState(campaignId);
    expect(reachable.enabled).toBe(true);
    expect(reachable.emailUrl).toBe(created.url);
    expect(reachable.inspectUrl).toBe(created.url);

    process.env.PUBLIC_APP_URL = "http://localhost:3000";
    try {
      const local = await publicNewsletter.getPublicPageState(campaignId);
      // It EXISTS...
      expect(local.enabled).toBe(true);
      // ...and can be opened by whoever is sitting at the machine...
      expect(local.inspectUrl).toBe(`http://localhost:3000/n/${created.token}`);
      // ...but must never be promised to a recipient.
      expect(local.emailUrl).toBeNull();
    } finally {
      process.env.PUBLIC_APP_URL = "https://mail.axis-gps.com";
    }
  });

  it("the inspect address is never rendered into an email", async () => {
    const created = await publicNewsletter.enablePublicPage(campaignId);
    if (!created.ok) throw new Error("enable failed");
    process.env.PUBLIC_APP_URL = "http://localhost:3000";
    try {
      const state = await publicNewsletter.getPublicPageState(campaignId);
      expect(state.inspectUrl).not.toBeNull();
      const preview = await newsletterService.getNewsletterPreview(campaignId);
      expect(preview?.document.viewInBrowserUrl ?? null).toBeNull();
      expect(preview?.html).not.toContain(state.inspectUrl!);
      expect(preview?.html).not.toContain("localhost");
    } finally {
      process.env.PUBLIC_APP_URL = "https://mail.axis-gps.com";
    }
  });

  it("the public route sends no email and has no transport", () => {
    const source = readFileSync(
      "src/server/services/publicNewsletterService.ts",
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const forbidden of [
      "getEmailProvider",
      "getQaEmailProvider",
      "getProductionEmailProvider",
      "nodemailer",
      "campaignRecipient",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("the public page is listed as a public route in the proxy", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain('"/n"');
  });
});
