/**
 * Deterministic E2E fixtures for `axis_ccp_test` (ADR-0031).
 *
 * Everything here is SYNTHETIC. No operational data is copied, and the script refuses
 * to run against anything that is not a test database — the same guard the test runner
 * and the reset tool use, repeated here because this script writes and deletes.
 *
 * The QA users get REAL Argon2id hashes and sign in through the ordinary Auth.js
 * credentials flow in the browser. Nothing impersonates a real AXIS employee, and no
 * actor is injected at the service layer: the audit trail names the synthetic users
 * truthfully.
 *
 * Credentials are generated per run and written to `e2e/.auth/credentials.json`, which
 * is git-ignored. Nothing is committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.TEST_DATABASE_URL;
const name = (() => {
  try {
    return new URL(url ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!name || (name !== "axis_ccp_test" && !name.endsWith("_test"))) {
  console.error("REFUSED — E2E fixtures may only be seeded into a test database.");
  console.error("Automated tests are not allowed to use the AXIS operational development database.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const argon2 = await import("@node-rs/argon2");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** OWASP baseline, matching `server/auth/password.ts`. */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const TAG = "e2e";
const password = `Qa-${randomUUID().slice(0, 12)}-Ax!9`;

async function upsertUser(email, name, role) {
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, role, passwordHash, isActive: true, mustChangePassword: false },
    update: { passwordHash, role, isActive: true, mustChangePassword: false },
    select: { id: true, email: true, role: true },
  });
}

// ---------------------------------------------------------------------------
// Wipe prior E2E fixtures (this database only, and only rows tagged as ours)
// ---------------------------------------------------------------------------
async function clearPriorFixtures() {
  await prisma.qaReviewCheck.deleteMany({ where: { send: { origin: "TEST_FIXTURE", fixtureOwner: TAG } } });
  await prisma.qaEmailSend.deleteMany({ where: { origin: "TEST_FIXTURE", fixtureOwner: TAG } });
  await prisma.qaEmailRun.deleteMany({ where: { origin: "TEST_FIXTURE", fixtureOwner: TAG } });

  const campaigns = await prisma.campaign.findMany({
    where: { name: { contains: TAG } },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);
  await prisma.campaignContentItem.deleteMany({ where: { campaignId: { in: campaignIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });

  await prisma.contentTranslation.deleteMany({ where: { sourceContentItem: { title: { contains: TAG } } } });
  await prisma.contentItem.deleteMany({ where: { title: { contains: TAG } } });
  await prisma.contentIngestionRun.deleteMany({
    where: { source: { name: { contains: TAG } } },
  });
  await prisma.newsletterAutomationSource.deleteMany({
    where: { automation: { name: { contains: TAG } } },
  });
  await prisma.newsletterAutomationRun.deleteMany({
    where: { automation: { name: { contains: TAG } } },
  });
  await prisma.newsletterAutomation.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.contentSource.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.segment.deleteMany({ where: { name: { contains: TAG } } });
}

await clearPriorFixtures();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const admin = await upsertUser("qa-admin@axis-test.invalid", "QA Administrator", "ADMIN");
const manager = await upsertUser("qa-manager@axis-test.invalid", "QA Manager", "MANAGER");
const inactive = await prisma.user.upsert({
  where: { email: "qa-inactive@axis-test.invalid" },
  create: {
    email: "qa-inactive@axis-test.invalid",
    name: "QA Inactive",
    role: "MANAGER",
    passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
    isActive: false,
  },
  update: { isActive: false, passwordHash: await argon2.hash(password, ARGON2_OPTIONS) },
  select: { id: true, email: true },
});

// ---------------------------------------------------------------------------
// Content source + articles (drives /sources, /content/inbox, /automations)
// ---------------------------------------------------------------------------
const source = await prisma.contentSource.create({
  data: {
    name: `${TAG} Fixture Feed`,
    kind: "RSS",
    feedUrl: "https://fixtures.example.com/feed.xml",
    baseUrl: "https://fixtures.example.com",
    language: "UNKNOWN",
    categories: ["hardware", "mapping"],
    isEnabled: true,
    createdById: admin.id,
  },
});

const articles = [];
for (const [index, title] of [
  `${TAG} Waiting article one`,
  `${TAG} Waiting article two`,
  `${TAG} Approved article one`,
  `${TAG} Approved article two`,
  `${TAG} Approved article three`,
  `${TAG} Rejected article`,
].entries()) {
  const approved = title.includes("Approved");
  const rejected = title.includes("Rejected");
  articles.push(
    await prisma.contentItem.create({
      data: {
        title,
        summary: `Synthetic excerpt for ${title}.`,
        language: "UNKNOWN",
        origin: "INGESTED",
        reviewState: approved ? "APPROVED" : rejected ? "REJECTED" : "PENDING_REVIEW",
        sourceId: source.id,
        sourceName: source.name,
        externalUrl: `https://fixtures.example.com/article-${index}`,
        canonicalUrl: `https://fixtures.example.com/article-${index}`,
        normalizedUrl: `fixtures.example.com/article-${index}`,
        externalId: `fixture-${index}`,
        publishedAt: new Date(Date.now() - index * 86_400_000),
        ingestedAt: new Date(),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// A synthetic translated draft; no provider is involved in browser fixtures.
// The source hash deliberately differs to exercise the changed-source warning.
const translatedArticle = await prisma.contentItem.create({ data: {
  title: `${TAG} מדידות מדויקות עם NavVis CLX`,
  summary: "גרסה עברית לבדיקה עם טווח מדידה של 40 m.",
  bodyText: "## מיפוי מהשטח\n\nמערכת **NavVis CLX** יוצרת ענן נקודות.\n\n- טווח מדידה של 40 m\n- [לכתבה המקורית](https://fixtures.example.com/article-0)",
  language: "HE", origin: "INGESTED", reviewState: "PENDING_REVIEW",
  sourceId: source.id, sourceName: source.name, externalUrl: articles[0].externalUrl,
  createdById: admin.id,
} });
await prisma.contentTranslation.create({ data: {
  sourceContentItemId: articles[0].id, sourceHash: "synthetic-before-source-edit",
  targetLanguage: "HE", state: "READY", requestedById: admin.id,
  model: "synthetic-browser-fixture", generatedContentItemId: translatedArticle.id, completedAt: new Date(),
} });

// A draft campaign with content (drives /newsletters and the editor)
// ---------------------------------------------------------------------------
const campaign = await prisma.campaign.create({
  data: {
    name: `${TAG} Draft newsletter`,
    subject: `${TAG} Subject line`,
    preheader: "Synthetic preheader",
    language: "HE",
    status: "DRAFT",
    createdById: manager.id,
  },
});
await prisma.campaignContentItem.createMany({
  data: articles
    .filter((a) => a.reviewState === "APPROVED")
    .map((a, position) => ({
      campaignId: campaign.id,
      contentItemId: a.id,
      position,
      isIncluded: true,
    })),
});

// ---------------------------------------------------------------------------
// QA ledger fixtures (drives /admin/qa-email and the review board)
// ---------------------------------------------------------------------------
const qaRun = await prisma.qaEmailRun.create({
  data: {
    label: `${TAG} closed QA run`,
    origin: "TEST_FIXTURE",
    fixtureOwner: TAG,
    status: "CLOSED",
    plannedCount: 2,
    closedAt: new Date(),
  },
});
const qaSends = [];
for (const [index, [recipient, scenarioId]] of [
  ["khaled-s@axis-gps.com", "QA-BASIC-EN"],
  ["moaawya@axis-gps.com", "QA-AR-RTL"],
].entries()) {
  qaSends.push(
    await prisma.qaEmailSend.create({
      data: {
        runId: qaRun.id,
        origin: "TEST_FIXTURE",
        fixtureOwner: TAG,
        recipient,
        subject: `[AXIS Newsletter Platform TEST] ${TAG} fixture ${index}`,
        scenarioId,
        purpose: "E2E fixture",
        provider: "FAKE_QA",
        providerMessageId: `<${TAG}-${randomUUID()}@fixture.test>`,
        state: "ACCEPTED",
        acceptedAt: new Date(),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// A segment (drives /segments)
// ---------------------------------------------------------------------------
const segment = await prisma.segment.create({
  data: {
    name: `${TAG} Fixture segment`,
    description: "Synthetic segment for E2E",
    criteria: { all: [] },
    createdById: manager.id,
  },
});

mkdirSync("e2e/.auth", { recursive: true });
writeFileSync(
  "e2e/.auth/credentials.json",
  JSON.stringify(
    {
      password,
      admin: { email: admin.email, id: admin.id },
      manager: { email: manager.email, id: manager.id },
      inactive: { email: inactive.email, id: inactive.id },
      fixtures: {
        sourceId: source.id,
        campaignId: campaign.id,
        segmentId: segment.id,
        qaRunId: qaRun.id,
        qaSendIds: qaSends.map((s) => s.id),
        pendingArticleId: articles.find((a) => a.reviewState === "PENDING_REVIEW").id,
        translatedArticleId: translatedArticle.id,
        approvedArticleIds: articles
          .filter((a) => a.reviewState === "APPROVED")
          .map((a) => a.id),
      },
    },
    null,
    2,
  ),
  "utf8",
);

console.log(
  `Seeded ${name}: 3 users, 1 source, ${articles.length} articles, 1 campaign, 1 segment, ${qaSends.length} QA sends.`,
);

await prisma.$disconnect();
