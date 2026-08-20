import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { unknownDomainAuth } from "../../src/domain/delivery/domainAuth";
import type { ProviderSendResult } from "../../src/server/integrations/email/emailProvider";
import type {
  ProductionEmailMessage,
  ProductionEmailProvider,
  ProductionProviderStatus,
  WebhookVerification,
} from "../../src/server/integrations/email/productionEmailProvider";
import {
  setProductionEmailProviderForTesting,
  setEmailProviderForTesting,
} from "../../src/server/integrations/email";
import { getPrisma } from "../../src/server/db/prisma";
import { FakeEmailProvider } from "../../src/server/integrations/email/fakeEmailProvider";
import * as contentService from "../../src/server/services/contentService";
import * as deliveryService from "../../src/server/services/deliveryService";
import * as newsletterService from "../../src/server/services/newsletterService";
import * as pilotService from "../../src/server/services/providerPilotService";
import * as testSendService from "../../src/server/services/testSendService";
import { actAs, clearTestActor, createTestUser, type TestUser } from "../support/actor";

/**
 * The internal PROVIDER PILOT, against real PostgreSQL (ADR-0025).
 *
 * NOTHING HERE REACHES A REAL PROVIDER. Both ports are replaced for the whole suite by
 * fakes that record what they were asked to do, so a regression that widened the
 * audience shows up as a recorded address rather than as an email.
 *
 * What these tests are actually protecting:
 *  - the pilot can reach exactly one address, and no configuration can move it;
 *  - a pilot approval and a Gmail SAFE TEST approval cannot substitute for each other;
 *  - a pilot writes no customer delivery rows;
 *  - production dispatch stays refused whatever the pilot switch says.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
let seq = 0;
const uid = (): string => `${RUN}${(seq++).toString(36)}`;

const created = { campaign: [] as string[], contentItem: [] as string[] };

/** Records every submission instead of transmitting one. */
class RecordingProductionProvider implements ProductionEmailProvider {
  readonly name = "RESEND" as const;
  readonly submissions: ProductionEmailMessage[] = [];

  constructor(
    private readonly configured = true,
    private readonly domainVerified = true,
  ) {}

  checkConfiguration(): ProductionProviderStatus {
    const domain = this.domainVerified
      ? {
          domain: "axis-gps.com",
          spf: "VERIFIED" as const,
          dkim: "VERIFIED" as const,
          dmarc: "UNKNOWN" as const,
          requiredDnsRecords: [],
        }
      : { ...unknownDomainAuth("axis-gps.com"), requiredDnsRecords: [] };

    return {
      configured: this.configured,
      enabled: false,
      name: this.name,
      problems: this.configured ? [] : ["No API key."],
      senderEmail: "newsletter@axis-gps.com",
      domain,
    };
  }

  async send(message: ProductionEmailMessage): Promise<ProviderSendResult> {
    this.submissions.push(message);
    return {
      outcome: "ACCEPTED",
      providerMessageId: `fake_${this.submissions.length}`,
      statusCode: 200,
      message: "Resend accepted the pilot email for delivery.",
    };
  }

  verifyWebhook(): WebhookVerification {
    return { ok: false, reason: "UNSIGNED", message: "Not verified." };
  }
}

d("internal provider pilot", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let provider: RecordingProductionProvider;
  let operator: TestUser;

  const newSendableNewsletter = async () => {
    const result = await newsletterService.createNewsletter({
      name: `NL ${uid()}`,
      subject: `Subject ${uid()}`,
      language: "HE",
    });
    if (!result.ok) throw new Error("fixture failed");
    created.campaign.push(result.data.id);

    const article = await contentService.createContent({
      title: `Article ${uid()}`,
      summary: "Summary",
      body: "Body **text**",
      language: "HE",
      origin: "INTERNAL",
    });
    if (!article.ok) throw new Error("fixture failed");
    created.contentItem.push(article.data.id);
    await contentService.setReviewState(article.data.id, "APPROVED");
    await newsletterService.addContent(result.data.id, article.data.id);

    return result.data.id;
  };

  /** The domain must LOOK verified for the pilot to be allowed to run at all. */
  const markDomainVerified = async () => {
    await prisma.providerDomainSnapshot.upsert({
      where: { provider_domain: { provider: "RESEND", domain: "axis-gps.com" } },
      create: {
        provider: "RESEND",
        domain: "axis-gps.com",
        status: "verified",
        spf: "VERIFIED",
        dkim: "VERIFIED",
        records: [],
      },
      update: { status: "verified", spf: "VERIFIED", dkim: "VERIFIED" },
    });
  };

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    operator = await createTestUser({ prefix: "pilot", role: "MANAGER" });
    actAs(operator);
    prisma = getPrisma();
    await prisma.$connect();

    for (const key of [
      "PROVIDER_PILOT_ENABLED",
      "NEWSLETTER_REPLY_TO",
      "PRODUCTION_DELIVERY_ENABLED",
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.PROVIDER_PILOT_ENABLED = "true";
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com";
    process.env.PRODUCTION_DELIVERY_ENABLED = "false";

    await markDomainVerified();
  });

  afterEach(() => {
    provider = new RecordingProductionProvider();
    setProductionEmailProviderForTesting(provider);
    setEmailProviderForTesting(new FakeEmailProvider());
  });

  afterAll(async () => {
    clearTestActor();
    // Never leave a fake installed, and never leave the pilot switch on.
    setProductionEmailProviderForTesting(undefined);
    setEmailProviderForTesting(undefined);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    try {
      await prisma.campaignTestSend.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.campaignTestApproval.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: created.campaign } } });
      await prisma.campaignContentItem.deleteMany({
        where: { campaignId: { in: created.campaign } },
      });
      await prisma.campaign.deleteMany({ where: { id: { in: created.campaign } } });
      await prisma.contentItem.deleteMany({ where: { id: { in: created.contentItem } } });
      await prisma.user.deleteMany({ where: { id: operator.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const install = (p: RecordingProductionProvider) => {
    provider = p;
    setProductionEmailProviderForTesting(p);
    setEmailProviderForTesting(new FakeEmailProvider());
  };

  // ------------------------------------------------------------- addresses

  it("sends to the one authorized internal address, from the AXIS production sender", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    const status = await pilotService.getPilotStatus(campaignId);
    expect(status?.toEmail).toBe("khaled-s@axis-gps.com");
    expect(status?.fromEmail).toBe("newsletter@axis-gps.com");
    expect(status?.replyToEmail).toBe("noreply@axis-gps.com");

    await pilotService.approvePilotSend(campaignId);
    const result = await pilotService.sendApprovedPilotEmail(campaignId);

    expect(result.ok).toBe(true);
    expect(provider.submissions).toHaveLength(1);
    expect(provider.submissions[0].to).toBe("khaled-s@axis-gps.com");
  });

  it("marks the subject so it can never be mistaken for a customer newsletter", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await pilotService.approvePilotSend(campaignId);
    await pilotService.sendApprovedPilotEmail(campaignId);

    expect(provider.submissions[0].subject).toMatch(/^\[AXIS PROVIDER PILOT\] /);
  });

  it("reports acceptance as accepted, never as delivered", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await pilotService.approvePilotSend(campaignId);
    const result = await pilotService.sendApprovedPilotEmail(campaignId);

    expect(result.message).toMatch(/accepted/i);
    expect(result.message).not.toMatch(/delivered to|was delivered/i);

    const row = await prisma.campaignTestSend.findFirst({
      where: { campaignId, channel: "PROVIDER_PILOT" },
    });
    // ACCEPTED, and `sentAt` stays null: only a delivery event proves delivery.
    expect(row?.state).toBe("ACCEPTED");
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.provider).toBe("RESEND");
  });

  // ------------------------------------------------------------- switches

  it("refuses to send while the pilot switch is off", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();
    await pilotService.approvePilotSend(campaignId);

    process.env.PROVIDER_PILOT_ENABLED = "false";
    try {
      const result = await pilotService.sendApprovedPilotEmail(campaignId);
      expect(result.ok).toBe(false);
      expect(provider.submissions).toHaveLength(0);
    } finally {
      process.env.PROVIDER_PILOT_ENABLED = "true";
    }
  });

  it("refuses to send while the provider is unconfigured", async () => {
    install(new RecordingProductionProvider(false));
    const campaignId = await newSendableNewsletter();
    await pilotService.approvePilotSend(campaignId);

    const result = await pilotService.sendApprovedPilotEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(provider.submissions).toHaveLength(0);
  });

  // ------------------------------------------------------------- approval

  it("binds the approval to the exact message — an edit invalidates it", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();
    await pilotService.approvePilotSend(campaignId);

    await newsletterService.updateNewsletterDetails(campaignId, {
      name: `NL ${uid()}`,
      subject: `Changed ${uid()}`,
      language: "HE",
    });

    const result = await pilotService.sendApprovedPilotEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/changed after approval|approve/i);
    expect(provider.submissions).toHaveLength(0);
  });

  it("consumes the approval, so one approval means at most one submission", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();
    await pilotService.approvePilotSend(campaignId);

    const first = await pilotService.sendApprovedPilotEmail(campaignId);
    const second = await pilotService.sendApprovedPilotEmail(campaignId);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(provider.submissions).toHaveLength(1);
  });

  it("survives a double-click: two concurrent sends produce one submission", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();
    await pilotService.approvePilotSend(campaignId);

    const [a, b] = await Promise.all([
      pilotService.sendApprovedPilotEmail(campaignId),
      pilotService.sendApprovedPilotEmail(campaignId),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(provider.submissions).toHaveLength(1);
  });

  // ------------------------------------------------- channel separation

  it("a Gmail SAFE TEST approval cannot authorize a pilot", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await testSendService.approveTestSend(campaignId);

    const status = await pilotService.getPilotStatus(campaignId);
    expect(status?.approval).toBeNull();

    const result = await pilotService.sendApprovedPilotEmail(campaignId);
    expect(result.ok).toBe(false);
    expect(provider.submissions).toHaveLength(0);
  });

  it("a pilot approval cannot authorize a Gmail SAFE TEST send", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await pilotService.approvePilotSend(campaignId);

    const status = await testSendService.getTestSendStatus(campaignId);
    expect(status?.approval).toBeNull();
    expect(status?.canSend).toBe(false);
  });

  it("approving a pilot does not revoke a live Gmail approval, or vice versa", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await testSendService.approveTestSend(campaignId);
    await pilotService.approvePilotSend(campaignId);

    const gmail = await testSendService.getTestSendStatus(campaignId);
    const pilot = await pilotService.getPilotStatus(campaignId);
    expect(gmail?.approval?.valid).toBe(true);
    expect(pilot?.approval?.valid).toBe(true);
  });

  // ------------------------------------------------- no customer state

  it("writes NO customer delivery rows — only the pilot attempt", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await pilotService.approvePilotSend(campaignId);
    await pilotService.sendApprovedPilotEmail(campaignId);

    const [recipients, events, finalAudience] = await Promise.all([
      prisma.campaignRecipient.count({ where: { campaignId } }),
      prisma.campaignEvent.count({ where: { campaignId } }),
      prisma.campaignFinalAudience.count({ where: { campaignId } }),
    ]);

    expect(recipients).toBe(0);
    expect(events).toBe(0);
    expect(finalAudience).toBe(0);
  });

  it("audits the approval and the attempt with the resolved addresses", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    await pilotService.approvePilotSend(campaignId);
    await pilotService.sendApprovedPilotEmail(campaignId);

    const actions = await prisma.auditLog.findMany({
      where: { entityId: campaignId },
      select: { action: true, actorUserId: true },
    });
    const names = actions.map((row) => row.action);
    expect(names).toContain("PROVIDER_PILOT_APPROVED");
    expect(names).toContain("PROVIDER_PILOT_ATTEMPTED");
    // Every pilot action names a real signed-in person.
    expect(actions.every((row) => row.actorUserId === operator.id)).toBe(true);
  });

  // ------------------------------------------------- production stays locked

  it("production dispatch stays refused even with the pilot switch on", async () => {
    install(new RecordingProductionProvider());
    const campaignId = await newSendableNewsletter();

    const result = await deliveryService.dispatchCampaign(campaignId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PRODUCTION_LOCKED");
    expect(result.providerCalls).toBe(0);
    expect(provider.submissions).toHaveLength(0);
  });

  /** Comments discuss the other channel deliberately; only real code is asserted on. */
  const codeOf = (relativePath: string): string =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  it("the pilot service never reaches the SAFE TEST transport", () => {
    const source = codeOf("../../src/server/services/providerPilotService.ts");
    expect(source).not.toMatch(/\bgetEmailProvider\b/);
    expect(source).not.toMatch(/nodemailer|smtp\.gmail\.com/);
  });

  it("the SAFE TEST service never reaches the production transport", () => {
    const source = codeOf("../../src/server/services/testSendService.ts");
    expect(source).not.toMatch(/getProductionEmailProvider/);
    expect(source).not.toMatch(/resend/i);
  });
});
