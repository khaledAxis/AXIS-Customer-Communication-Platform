import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../src/server/db/prisma";

/**
 * DB integration tests — require a real PostgreSQL `DATABASE_URL`.
 * They SELF-SKIP (reported BLOCKED) when no database is configured, so unit tests
 * still run. Do NOT substitute SQLite: these assert PostgreSQL-backed constraints.
 *
 * When a test database is available, run: DATABASE_URL=... npm run db:deploy && npm test
 *
 * REPEATABILITY: every row is created with a run-scoped unique value and removed in
 * `afterAll`, so the suite can be run repeatedly against the same development database
 * without a reset. Cleanup deletes ONLY the ids this run created — it never truncates
 * tables and never touches pre-existing data.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

/**
 * Run-scoped token. UUID-based rather than `Date.now()` alone: two processes started
 * in the same millisecond would collide on a timestamp, which would reintroduce exactly
 * the cross-run failure this file exists to prevent.
 */
const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
let seq = 0;
/** Unique, run-scoped, collision-proof suffix. */
const uid = (): string => `${RUN}${(seq++).toString(36)}`;
/**
 * Test address on the reserved `.invalid` TLD (RFC 2606) — guaranteed non-routable, so
 * test data can never correspond to a real mailbox on a platform that sends email.
 */
const addr = (label: string): string => `${label}-${uid()}@axis-test.invalid`;

/** Ids created by THIS run only. Cleanup order below respects FK/onDelete rules. */
const created = {
  campaignContentItem: [] as string[],
  campaignRecipient: [] as string[],
  finalAudience: [] as string[],
  automationRun: [] as string[],
  campaign: [] as string[],
  automation: [] as string[],
  contentItem: [] as string[],
  contentSource: [] as string[],
  communicationAddress: [] as string[],
  contact: [] as string[],
  user: [] as string[],
};

d("PostgreSQL-backed constraints", () => {
  // Deferred: getPrisma() must not run during collection when the suite is skipped.
  let prisma: ReturnType<typeof getPrisma>;

  const newUser = async () => {
    const user = await prisma.user.create({
      data: { email: addr("user"), passwordHash: "test-only-not-a-real-hash" },
    });
    created.user.push(user.id);
    return user;
  };

  const newCampaign = async (name: string) => {
    const user = await newUser();
    const campaign = await prisma.campaign.create({
      data: { name, language: "HE", createdById: user.id },
    });
    created.campaign.push(campaign.id);
    return campaign;
  };

  /**
   * A campaign plus the frozen audience its recipients must originate from.
   *
   * `CampaignRecipient.finalAudienceId` is required (ADR-0024): a delivery destination
   * with no provenance is one nobody approved, so these fixtures have to go through
   * the same door production does.
   */
  const newCampaignWithAudience = async (name: string) => {
    const campaign = await newCampaign(name);
    const audience = await prisma.campaignFinalAudience.create({
      data: {
        campaignId: campaign.id,
        segmentName: `${name} audience`,
        segmentCriteria: { version: 1, conditions: [], groups: [] },
        campaignLanguage: "HE",
        matchedCompanies: 0,
        matchedContacts: 0,
        matchedRecords: 0,
        withCandidateEmail: 0,
        eligible: 0,
        uniqueDestinations: 0,
        excluded: 0,
        duplicateSourcesCollapsed: 0,
        breakdown: {},
        audienceHash: `hash-${name}-${RUN}`,
        createdById: campaign.createdById,
      },
    });
    created.finalAudience.push(audience.id);
    return { campaign, audience };
  };

  beforeAll(async () => {
    prisma = getPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    try {
      // Ordered so no RESTRICT relation is ever violated:
      // links → recipients/runs → campaigns → automations → content → addresses/contacts → users.
      const byId = (ids: string[]) => ({ where: { id: { in: ids } } });
      await prisma.campaignContentItem.deleteMany(byId(created.campaignContentItem));
      await prisma.campaignRecipient.deleteMany(byId(created.campaignRecipient));
      await prisma.campaignFinalAudience.deleteMany(byId(created.finalAudience));
      await prisma.newsletterAutomationRun.deleteMany(byId(created.automationRun));
      await prisma.campaign.deleteMany(byId(created.campaign));
      await prisma.newsletterAutomation.deleteMany(byId(created.automation));
      await prisma.contentItem.deleteMany(byId(created.contentItem));
      await prisma.contentSource.deleteMany(byId(created.contentSource));
      await prisma.communicationAddress.deleteMany(byId(created.communicationAddress));
      await prisma.contact.deleteMany(byId(created.contact));
      await prisma.user.deleteMany(byId(created.user));
    } finally {
      await prisma.$disconnect();
    }
  });

  it("CommunicationAddress.normalizedEmail is globally unique", async () => {
    const email = addr("unique");
    const first = await prisma.communicationAddress.create({ data: { normalizedEmail: email } });
    created.communicationAddress.push(first.id);
    await expect(
      prisma.communicationAddress.create({ data: { normalizedEmail: email } }),
    ).rejects.toThrow();
  });

  it("CampaignRecipient is unique per (campaignId, normalizedEmail)", async () => {
    const { campaign, audience } = await newCampaignWithAudience("c");
    const email = addr("dup");
    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        finalAudienceId: audience.id,
        normalizedEmail: email,
        intendedEmail: email,
      },
    });
    created.campaignRecipient.push(recipient.id);
    await expect(
      prisma.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          finalAudienceId: audience.id,
          normalizedEmail: email,
          intendedEmail: email,
        },
      }),
    ).rejects.toThrow();
  });

  it("CampaignRecipient cannot exist without a final audience", async () => {
    // The provenance requirement is a database constraint, not a convention: there is
    // no way to write a delivery destination that nobody approved (ADR-0024).
    const campaign = await newCampaign("no-audience");
    const email = addr("orphan");
    await expect(
      prisma.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          finalAudienceId: "does-not-exist",
          normalizedEmail: email,
          intendedEmail: email,
        },
      }),
    ).rejects.toThrow();
  });

  it("deleting a Campaign with recipients is blocked (Restrict) — history protected", async () => {
    const { campaign, audience } = await newCampaignWithAudience("c2");
    const email = addr("history");
    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        finalAudienceId: audience.id,
        normalizedEmail: email,
        intendedEmail: email,
      },
    });
    created.campaignRecipient.push(recipient.id);
    await expect(prisma.campaign.delete({ where: { id: campaign.id } })).rejects.toThrow();
  });

  it("deleting the final audience a recipient came from is blocked (Restrict)", async () => {
    const { campaign, audience } = await newCampaignWithAudience("c3");
    const email = addr("provenance");
    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        finalAudienceId: audience.id,
        normalizedEmail: email,
        intendedEmail: email,
      },
    });
    created.campaignRecipient.push(recipient.id);
    // A prepared ledger protects the snapshot it was derived from.
    await expect(
      prisma.campaignFinalAudience.delete({ where: { id: audience.id } }),
    ).rejects.toThrow();
  });

  it("a sync-style upsert of a Contact does not touch CommunicationAddress local state", async () => {
    const email = addr("immune");
    const address = await prisma.communicationAddress.create({
      data: { normalizedEmail: email, language: "HE", consentStatus: "DENIED" },
    });
    created.communicationAddress.push(address.id);

    // Simulate a CRM sync writing only Monday-owned fields.
    const identity = { mondayBoardId: "1903020916", mondayItemId: uid() };
    const contact = await prisma.contact.upsert({
      where: { mondayBoardId_mondayItemId: identity },
      create: { ...identity, email, emailNorm: email },
      update: { email, emailNorm: email },
    });
    created.contact.push(contact.id);

    const after = await prisma.communicationAddress.findUnique({
      where: { normalizedEmail: email },
    });
    expect(after?.language).toBe("HE");
    expect(after?.consentStatus).toBe("DENIED");
  });

  it("prevents adding the same ContentItem twice to one Campaign", async () => {
    const campaign = await newCampaign("cc");
    const item = await prisma.contentItem.create({ data: { title: `Article ${uid()}` } });
    created.contentItem.push(item.id);

    const link = await prisma.campaignContentItem.create({
      data: { campaignId: campaign.id, contentItemId: item.id, position: 1 },
    });
    created.campaignContentItem.push(link.id);

    await expect(
      prisma.campaignContentItem.create({
        data: { campaignId: campaign.id, contentItemId: item.id, position: 2 },
      }),
    ).rejects.toThrow();
  });

  it("prevents two automation runs for the same (automation, occurrence)", async () => {
    const user = await newUser();
    const automation = await prisma.newsletterAutomation.create({
      data: {
        name: `Weekly ${uid()}`,
        cadence: "WEEKLY",
        dayOfWeek: 1,
        language: "HE",
        createdById: user.id,
      },
    });
    created.automation.push(automation.id);

    const when = new Date("2026-09-07T06:00:00.000Z");
    const run = await prisma.newsletterAutomationRun.create({
      data: { automationId: automation.id, scheduledFor: when },
    });
    created.automationRun.push(run.id);

    await expect(
      prisma.newsletterAutomationRun.create({
        data: { automationId: automation.id, scheduledFor: when },
      }),
    ).rejects.toThrow();
  });

  it("dedupes external content by (sourceId, externalId)", async () => {
    const source = await prisma.contentSource.create({
      data: { name: `Trimble ${uid()}`, kind: "RSS", baseUrl: "https://example.com/feed" },
    });
    created.contentSource.push(source.id);

    const externalId = `ext-${uid()}`;
    const item = await prisma.contentItem.create({
      data: {
        title: "A",
        origin: "INGESTED",
        reviewState: "PENDING_REVIEW",
        sourceId: source.id,
        externalId,
      },
    });
    created.contentItem.push(item.id);

    await expect(
      prisma.contentItem.create({
        data: {
          title: "A dup",
          origin: "INGESTED",
          reviewState: "PENDING_REVIEW",
          sourceId: source.id,
          externalId,
        },
      }),
    ).rejects.toThrow();
  });
});
