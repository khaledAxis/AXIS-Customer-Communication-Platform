/**
 * One-off ledger recovery for the QA run of 2026-08-24 (ADR-0028).
 *
 * WHY THIS FILE EXISTS AND IS COMMITTED
 * ------------------------------------
 * Twenty real QA emails were submitted to Gmail on 2026-08-24 and all twenty were
 * accepted. An integration suite's cleanup then deleted the ledger rows recording
 * them, along with their audit entries. That did not merely lose history: the send
 * caps are computed by counting those rows, so deleting them silently handed back
 * quota for twenty emails that had already been sent.
 *
 * This script reconstructs those twenty rows so the caps tell the truth again.
 *
 * PROVENANCE — the reason this is a recovery and not a fabrication
 * ---------------------------------------------------------------
 * Every value below was transcribed from the output of the live run itself, which
 * printed one line per send containing the recipient, the scenario, the provider's own
 * `messageId`, and the acceptance timestamp. Nothing here is inferred, averaged, or
 * invented. No provider id was generated.
 *
 * Each reconstructed row is marked `ledgerRecovered = true` and carries a
 * `recoveryNote`, so the ledger never presents these as rows written at send time. A
 * reader can always tell a recovered record from a live one.
 *
 * It is idempotent: `providerMessageId` is UNIQUE, and the script skips any id already
 * present, so running it twice cannot double-count quota.
 *
 * Run with:  node scripts/recover-qa-ledger-20260824.mjs
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const RUN_LABEL = "QA run 2026-08-24 (recovered)";
const RECOVERY_NOTE =
  "Reconstructed from the recorded output of the live QA run of 2026-08-24. " +
  "The original ledger rows were deleted by an integration-suite cleanup defect " +
  "(ADR-0028). Provider message ids and acceptance timestamps are transcribed " +
  "verbatim from that run; none was generated.";

/** Transcribed verbatim from the completed run's output. */
const SENDS = [
  ["khaled-s@axis-gps.com", "QA-BASIC-EN", "Basic Email Delivery", "156013b1-ccba-870d-1239-97b2e070285c", "2026-08-24T07:38:51.587Z"],
  ["khaled-s@axis-gps.com", "QA-HE-RTL", "Hebrew RTL Rendering", "ead54b6a-8336-8afc-ad2a-2dcabfb2af07", "2026-08-24T07:38:53.881Z"],
  ["khaled-s@axis-gps.com", "QA-MULTI-HE", "Multi-Article Newsletter", "7d1a10f5-481a-4d79-1db6-44e4a9977777", "2026-08-24T07:38:56.238Z"],
  ["khaled-s@axis-gps.com", "QA-REPLY-TO", "Reply-To Verification", "b8d725c7-3b73-33cd-c0cc-634c84c8e8aa", "2026-08-24T07:38:58.533Z"],
  ["khaled-s@axis-gps.com", "QA-IMAGES", "Cloudinary Image Verification", "b324733b-ea96-35ed-21f9-b70dfdbbc9f0", "2026-08-24T07:39:01.001Z"],

  ["moaawya@axis-gps.com", "QA-AR-RTL", "Arabic RTL Rendering", "bde22789-0320-9ab9-f98d-f7f2298685c3", "2026-08-24T07:39:03.278Z"],
  ["moaawya@axis-gps.com", "QA-AR-MIXED", "Mixed Arabic / English Rendering", "f8cd9d3b-ff12-14ae-5346-0505c7b20444", "2026-08-24T07:39:05.583Z"],
  ["moaawya@axis-gps.com", "QA-MULTI-AR", "Multi-Article Newsletter", "3dfed360-bf3e-0fb3-d5f5-598d9bcaf41f", "2026-08-24T07:39:07.926Z"],
  ["moaawya@axis-gps.com", "QA-IMAGE-OMISSION", "Non-Deliverable Image Omission", "b8890ebb-46db-6116-5c82-f1411c538d18", "2026-08-24T07:39:10.265Z"],
  ["moaawya@axis-gps.com", "QA-PLAIN-TEXT", "Plain Text Fallback", "56e1d5e6-36c2-992c-ed95-112bdc0f87c4", "2026-08-24T07:39:12.600Z"],

  ["info@axis-gps.com", "QA-BASIC-EN", "Basic Email Delivery", "7db961f4-4f87-4257-a395-b442d341f463", "2026-08-24T07:39:14.859Z"],
  ["info@axis-gps.com", "QA-REALISTIC", "General AXIS Newsletter Rendering", "991f36fd-d0e1-baa8-5a0f-d694868a0b5f", "2026-08-24T07:39:17.176Z"],
  ["info@axis-gps.com", "QA-LONG", "Long Content Boundary Test", "422e3ca0-190c-81da-9ab6-2dff9d808ebe", "2026-08-24T07:39:19.552Z"],
  ["info@axis-gps.com", "QA-FOOTER", "Footer and Unsubscribe Verification", "228c7aab-e264-87ab-c1d0-71ac95d9133d", "2026-08-24T07:39:21.853Z"],
  ["info@axis-gps.com", "QA-IMAGES", "Cloudinary Image Verification", "de0357f3-a318-4d2b-e5da-3b7781a9059e", "2026-08-24T07:39:24.173Z"],

  ["saja@axis-gps.com", "QA-BASIC-EN", "Basic Email Delivery", "49759f2d-0cd6-1808-d3ed-fbcc9b52d9c6", "2026-08-24T07:39:26.482Z"],
  ["saja@axis-gps.com", "QA-HE-RTL", "Hebrew RTL Rendering", "b88dd77e-e09d-d96b-0b82-2ac8835e8de9", "2026-08-24T07:39:28.987Z"],
  ["saja@axis-gps.com", "QA-HE-MIXED", "Mixed Hebrew / English Rendering", "0b67f99b-88da-f91a-d006-2df87e0c2180", "2026-08-24T07:39:31.414Z"],
  ["saja@axis-gps.com", "QA-CTA", "CTA and Layout Verification", "ed62d0e3-5a7c-8c41-4ae1-1fe75083a37e", "2026-08-24T07:39:34.022Z"],
  ["saja@axis-gps.com", "QA-MULTI-EN", "Multi-Article Newsletter", "fd4dc2d1-8cfd-001d-0f29-a0e367a3abe2", "2026-08-24T07:39:36.336Z"],
];

const PREFIX = "[AXIS Newsletter Platform TEST]";

async function main() {
  const actor = await prisma.user.findUnique({
    where: { email: "khaled-s@axis-gps.com" },
    select: { id: true },
  });

  // The run this recovery belongs to. CLOSED: it is finished history, not somewhere
  // new sends may be added.
  let run = await prisma.qaEmailRun.findFirst({
    where: { label: RUN_LABEL, origin: "LIVE" },
  });
  if (!run) {
    run = await prisma.qaEmailRun.create({
      data: {
        label: RUN_LABEL,
        origin: "LIVE",
        status: "CLOSED",
        plannedCount: SENDS.length,
        note: RECOVERY_NOTE,
        createdById: actor?.id ?? null,
        closedAt: new Date("2026-08-24T07:39:40.000Z"),
      },
    });
    console.log(`created recovered run ${run.id}`);
  } else {
    console.log(`reusing recovered run ${run.id}`);
  }

  let created = 0;
  let skipped = 0;

  for (const [recipient, scenarioId, subjectTail, rawId, acceptedAt] of SENDS) {
    const providerMessageId = `<${rawId}@gmail.com>`;

    const existing = await prisma.qaEmailSend.findUnique({
      where: { providerMessageId },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.qaEmailSend.create({
      data: {
        runId: run.id,
        origin: "LIVE",
        recipient,
        subject: `${PREFIX} ${subjectTail}`,
        scenarioId,
        purpose: `Recovered record of the 2026-08-24 QA run (${scenarioId}).`,
        provider: "GMAIL_QA",
        providerMessageId,
        state: "ACCEPTED",
        requestedAt: new Date(acceptedAt),
        acceptedAt: new Date(acceptedAt),
        requestedById: actor?.id ?? null,
        ledgerRecovered: true,
        recoveryNote: RECOVERY_NOTE,
      },
    });
    created += 1;
  }

  if (created > 0) {
    await prisma.auditLog.create({
      data: {
        action: "QA_LEDGER_RECOVERED",
        actorUserId: actor?.id ?? null,
        entityType: "QaEmailRun",
        entityId: run.id,
        toState: "RECOVERED",
        metadata: {
          recovered: created,
          skippedAlreadyPresent: skipped,
          sourceOfTruth:
            "Recorded output of the live QA run of 2026-08-24; provider message ids transcribed verbatim.",
          reason:
            "Original rows deleted by an integration-suite cleanup defect (ADR-0028).",
          ledgerRecovered: true,
        },
      },
    });
  }

  const counts = await prisma.qaEmailSend.groupBy({
    by: ["recipient"],
    where: { origin: "LIVE", state: { in: ["SENDING", "ACCEPTED", "UNCERTAIN"] } },
    _count: true,
  });

  console.log(`recovered ${created}, already present ${skipped}`);
  for (const row of counts) console.log(`  ${row.recipient}: ${row._count}`);
  console.log(`  TOTAL: ${counts.reduce((sum, row) => sum + row._count, 0)}`);
}

await main();
await prisma.$disconnect();
