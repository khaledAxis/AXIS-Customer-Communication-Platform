/**
 * E2E preflight (ADR-0031, requirement §36).
 *
 * The stale-Prisma incident happened because a long-running Next.js process held a
 * client generated before several models existed — and every page that used them
 * crashed at runtime while the service suites stayed green.
 *
 * This aborts the E2E run BEFORE a browser opens if the generated client is missing a
 * delegate any page needs. Failing here costs seconds; failing in the browser costs a
 * confusing debugging session, and failing silently costs a production incident.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const REQUIRED_DELEGATES = [
  "contentSource",
  "contentItem",
  "contentIngestionRun",
  "newsletterAutomation",
  "newsletterAutomationRun",
  "newsletterAutomationSource",
  "providerDomainSnapshot",
  "qaEmailRun",
  "qaEmailSend",
  "qaReviewCheck",
  "campaign",
  "campaignContentItem",
  "company",
  "contact",
  "communicationAddress",
  "segment",
  "user",
  "auditLog",
];

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("PREFLIGHT FAIL: TEST_DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const missing = REQUIRED_DELEGATES.filter(
  (name) => typeof prisma[name]?.findFirst !== "function",
);

if (missing.length > 0) {
  console.error("");
  console.error("  PREFLIGHT FAIL — the generated Prisma Client is STALE.");
  console.error("");
  console.error(`  Missing delegates: ${missing.join(", ")}`);
  console.error("");
  console.error("  Run:  npx prisma generate");
  console.error("  Then RESTART the Next.js server — Turbopack does not pick up a");
  console.error("  regenerated client through HMR.");
  console.error("");
  await prisma.$disconnect();
  process.exit(1);
}

// Prove the client can actually reach the test database too.
try {
  const [{ db }] = await prisma.$queryRawUnsafe("SELECT current_database() AS db");
  if (!db.endsWith("_test")) {
    console.error(`PREFLIGHT FAIL: connected to "${db}", which is not a test database.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Preflight OK — ${REQUIRED_DELEGATES.length} delegates present, database "${db}".`);
} catch (error) {
  console.error(`PREFLIGHT FAIL: ${error.message}`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.$disconnect();
