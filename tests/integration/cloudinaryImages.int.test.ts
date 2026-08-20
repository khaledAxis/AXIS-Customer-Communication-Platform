import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

import { getPrisma } from "../../src/server/db/prisma";
import { setMediaStoreForTesting } from "../../src/server/media";
import { MediaUploadError, type MediaStore, type PutMediaInput } from "../../src/server/media/mediaStore";
import { uploadNewsletterImage } from "../../src/server/services/mediaService";
import { FakeEmailProvider } from "../../src/server/integrations/email/fakeEmailProvider";
import { setEmailProviderForTesting } from "../../src/server/integrations/email";
import * as contentService from "../../src/server/services/contentService";
import * as newsletterService from "../../src/server/services/newsletterService";
import * as testSendService from "../../src/server/services/testSendService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Cloudinary-backed images end to end, against real PostgreSQL with a FAKE media store.
 *
 * No test performs a live Cloudinary upload: the store is replaced for the whole suite
 * and restored afterwards. Repeatable — run-scoped values, scoped cleanup.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
let seq = 0;
const uid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = { campaign: [] as string[], contentItem: [] as string[] };

/** Stands in for Cloudinary: returns HTTPS delivery URLs, records every upload. */
class FakeCloudinaryStore implements MediaStore {
  readonly provider = "CLOUDINARY" as const;
  readonly uploads: PutMediaInput[] = [];
  readonly removed: string[] = [];
  failWith: MediaUploadError | null = null;

  checkConfiguration() {
    return { configured: true, problems: [], message: "Cloudinary image storage ready" };
  }

  async put(input: PutMediaInput) {
    if (this.failWith) throw this.failWith;
    this.uploads.push(input);
    const id = `asset-${uid()}`;
    return {
      filename: `axis-newsletter/content/${id}`,
      url: `https://res.cloudinary.com/axis-demo/image/upload/v1/axis-newsletter/content/${id}.png`,
      mimeType: input.mimeType,
      byteLength: input.bytes.byteLength,
    };
  }

  async read() {
    return null;
  }

  /** Mirrors the real adapter: never destroys, so historical mail keeps working. */
  async remove(filename: string) {
    this.removed.push(filename);
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

d("Cloudinary-backed newsletter images", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let media: FakeCloudinaryStore;
  let email: FakeEmailProvider;

  const install = () => {
    media = new FakeCloudinaryStore();
    setMediaStoreForTesting(media);
    email = new FakeEmailProvider();
    setEmailProviderForTesting(email);
  };

  const newArticle = async (overrides: Record<string, unknown> = {}) => {
    const result = await contentService.createContent({
      title: `Article ${uid()}`,
      summary: "Summary",
      language: "HE",
      origin: "INTERNAL",
      ...overrides,
    });
    if (!result.ok) throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
    created.contentItem.push(result.data.id);
    await contentService.setReviewState(result.data.id, "APPROVED");
    return result.data;
  };

  const newNewsletter = async () => {
    const result = await newsletterService.createNewsletter({
      name: `NL ${uid()}`,
      subject: `Subject ${uid()}`,
      language: "HE",
    });
    if (!result.ok) throw new Error("fixture failed");
    created.campaign.push(result.data.id);
    return result.data;
  };

  /** Every service call in this suite runs as a real, signed-in manager. */

  let operator: TestUser;


  beforeAll(async () => {

    operator = await createTestUser({ prefix: "cloudinary", role: "MANAGER" });

    actAs(operator);
    prisma = getPrisma();
    await prisma.$connect();
  });

  afterEach(() => install());

  afterAll(async () => {

    clearTestActor();
    setMediaStoreForTesting(undefined);
    setEmailProviderForTesting(undefined);
    try {
      await prisma.campaignTestSend.deleteMany({ where: { campaignId: { in: created.campaign } } });
      await prisma.campaignTestApproval.deleteMany({ where: { campaignId: { in: created.campaign } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: created.campaign } } });
      await prisma.campaignContentItem.deleteMany({ where: { campaignId: { in: created.campaign } } });
      await prisma.campaign.deleteMany({ where: { id: { in: created.campaign } } });
      await prisma.contentItem.deleteMany({ where: { id: { in: created.contentItem } } });
    } finally {
      await prisma.$disconnect();
    }
  
    await getPrisma().user.deleteMany({ where: { id: operator.id } });
});

  // ------------------------------------------------------------- upload + validation

  it.each([
    ["PNG", "photo.png", "image/png", PNG],
    ["JPEG", "photo.jpg", "image/jpeg", JPEG],
    ["WebP", "photo.webp", "image/webp", WEBP],
  ])("accepts a genuine %s and returns an HTTPS URL", async (_label, name, type, bytes) => {
    install();
    const result = await uploadNewsletterImage({ name, type, bytes });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.media.url.startsWith("https://")).toBe(true);
      expect(result.media.url).toContain("res.cloudinary.com");
    }
  });

  it("rejects SVG before any upload is attempted", async () => {
    install();
    const result = await uploadNewsletterImage({
      name: "x.svg",
      type: "image/svg+xml",
      bytes: SVG,
    });
    expect(result.ok).toBe(false);
    expect(media.uploads).toHaveLength(0);
  });

  it("rejects HTML disguised as a PNG before any upload", async () => {
    install();
    const result = await uploadNewsletterImage({ name: "evil.png", type: "image/png", bytes: HTML });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CONTENT_DOES_NOT_MATCH_TYPE");
    expect(media.uploads).toHaveLength(0);
  });

  it("rejects an oversized file before any upload", async () => {
    install();
    const huge = new Uint8Array(6 * 1024 * 1024);
    huge.set(PNG);
    const result = await uploadNewsletterImage({ name: "big.png", type: "image/png", bytes: huge });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("TOO_LARGE");
    expect(media.uploads).toHaveLength(0);
  });

  it("returns a friendly message and no URL when the provider fails", async () => {
    install();
    media.failWith = new MediaUploadError("CLOUDINARY_AUTH_REJECTED", "Image storage rejected the credentials.");
    const result = await uploadNewsletterImage({ name: "x.png", type: "image/png", bytes: PNG });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("cloudinary://");
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("leaves the existing article image untouched when an upload fails", async () => {
    install();
    const original = "https://res.cloudinary.com/axis-demo/image/upload/v1/original.png";
    const article = await newArticle({ imageUrl: original });

    media.failWith = new MediaUploadError("CLOUDINARY_UNREACHABLE", "Could not reach image storage.");
    const upload = await uploadNewsletterImage({ name: "new.png", type: "image/png", bytes: PNG });
    expect(upload.ok).toBe(false);

    // The article is only updated with a URL a successful upload produced.
    const stored = await contentService.getContent(article.id);
    expect(stored?.imageUrl).toBe(original);
  });

  // ------------------------------------------------------------------- rendering

  it("renders a Cloudinary hero with email sizing and no localhost", async () => {
    install();
    const upload = await uploadNewsletterImage({ name: "hero.png", type: "image/png", bytes: PNG });
    if (!upload.ok) throw new Error("upload failed");

    const article = await newArticle({ imageUrl: upload.media.url, imageAlt: "AXIS field team" });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, article.id);

    const rendered = await testSendService.renderTestEmail(newsletter.id);
    expect(rendered!.html).toContain("res.cloudinary.com");
    expect(rendered!.html).toContain("c_limit,w_1280,q_auto");
    expect(rendered!.html).toContain('alt="AXIS field team"');
    expect(rendered!.html).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(rendered!.omittedImageCount).toBe(0);
  });

  it("still omits a local image while including a Cloudinary one", async () => {
    install();
    const upload = await uploadNewsletterImage({ name: "ok.png", type: "image/png", bytes: PNG });
    if (!upload.ok) throw new Error("upload failed");

    const hosted = await newArticle({ imageUrl: upload.media.url });
    const local = await newArticle({ imageUrl: `/api/media/local-${uid()}.png` });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, hosted.id);
    await newsletterService.addContent(newsletter.id, local.id);

    const rendered = await testSendService.renderTestEmail(newsletter.id);
    expect(rendered!.html).toContain("res.cloudinary.com");
    expect(rendered!.html).not.toMatch(/localhost|127\.0\.0\.1|\/api\/media\//);
    expect(rendered!.omittedImageCount).toBe(1);
  });

  it("uses the identical image URL in preview and in what would be sent", async () => {
    install();
    const upload = await uploadNewsletterImage({ name: "p.png", type: "image/png", bytes: PNG });
    if (!upload.ok) throw new Error("upload failed");

    const article = await newArticle({ imageUrl: upload.media.url });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, article.id);

    const preview = await newsletterService.getNewsletterPreview(newsletter.id);
    await testSendService.approveTestSend(newsletter.id);
    await testSendService.sendApprovedTestEmail(newsletter.id);

    expect(email.sent[0].html).toBe(preview!.html);
    const imageSrc = /<img src="([^"]+)"/.exec(email.sent[0].html)?.[1];
    expect(imageSrc).toContain("res.cloudinary.com");
    expect(preview!.html).toContain(imageSrc!);
  });

  it("puts no Cloudinary secret in the generated newsletter HTML", async () => {
    install();
    const upload = await uploadNewsletterImage({ name: "s.png", type: "image/png", bytes: PNG });
    if (!upload.ok) throw new Error("upload failed");
    const article = await newArticle({ imageUrl: upload.media.url });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, article.id);

    const rendered = await testSendService.renderTestEmail(newsletter.id);
    expect(rendered!.html).not.toContain("cloudinary://");
    expect(rendered!.html).not.toMatch(/api_key|api_secret|CLOUDINARY_URL/i);
  });

  // ------------------------------------------------------- replacement + approval

  it("replacing an image changes the stored URL and keeps the old asset", async () => {
    install();
    const first = await uploadNewsletterImage({ name: "one.png", type: "image/png", bytes: PNG });
    if (!first.ok) throw new Error("upload failed");
    const article = await newArticle({ imageUrl: first.media.url });

    const second = await uploadNewsletterImage({ name: "two.png", type: "image/png", bytes: PNG });
    if (!second.ok) throw new Error("upload failed");
    await contentService.updateContent(article.id, {
      title: article.title,
      language: article.language,
      imageUrl: second.media.url,
    });

    const stored = await contentService.getContent(article.id);
    expect(stored?.imageUrl).toBe(second.media.url);
    expect(second.media.url).not.toBe(first.media.url);
    // Historical safety: the previous asset is never destroyed on replacement.
    expect(media.removed).toHaveLength(0);
  });

  it("replacing the image INVALIDATES an existing test-send approval", async () => {
    install();
    const first = await uploadNewsletterImage({ name: "a.png", type: "image/png", bytes: PNG });
    if (!first.ok) throw new Error("upload failed");
    const article = await newArticle({ imageUrl: first.media.url });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, article.id);

    expect((await testSendService.approveTestSend(newsletter.id)).ok).toBe(true);

    const second = await uploadNewsletterImage({ name: "b.png", type: "image/png", bytes: PNG });
    if (!second.ok) throw new Error("upload failed");
    await contentService.updateContent(article.id, {
      title: article.title,
      language: article.language,
      imageUrl: second.media.url,
    });

    const status = await testSendService.getTestSendStatus(newsletter.id);
    expect(status!.canSend).toBe(false);
    expect(status!.approval?.reason).toBe("CONTENT_CHANGED");

    const send = await testSendService.sendApprovedTestEmail(newsletter.id);
    expect(send.ok).toBe(false);
    expect(email.callCount).toBe(0);
  });

  it("keeps the SAFE TEST addresses unchanged with hosted images", async () => {
    install();
    const upload = await uploadNewsletterImage({ name: "z.png", type: "image/png", bytes: PNG });
    if (!upload.ok) throw new Error("upload failed");
    const article = await newArticle({ imageUrl: upload.media.url });
    const newsletter = await newNewsletter();
    await newsletterService.addContent(newsletter.id, article.id);

    const status = await testSendService.getTestSendStatus(newsletter.id);
    expect(status!.fromEmail).toBe("axisgpscana@gmail.com");
    expect(status!.toEmail).toBe("khaled-s@axis-gps.com");
    expect(status!.sendMode).toBe("TEST");
    expect(await prisma.campaignRecipient.count({ where: { campaignId: newsletter.id } })).toBe(0);
  });
});
