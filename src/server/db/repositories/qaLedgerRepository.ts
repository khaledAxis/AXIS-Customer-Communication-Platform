import "server-only";

import { getPrisma } from "../prisma";

/**
 * The QA ledger's only write path (ADR-0028).
 *
 * This module exists because of a specific incident: an integration suite's cleanup
 * deleted twenty rows recording twenty real emails, and in doing so silently restored
 * the send quota that is computed by counting them. A deleted row did not just lose
 * history — it handed back permission to send.
 *
 * So the protection is structural rather than procedural:
 *
 *  - LIVE rows have NO delete path. `deleteFixtures` filters on
 *    `origin: TEST_FIXTURE` **and** a non-null `fixtureOwner`, so a live row cannot
 *    match the query even if a caller asks for it by id.
 *  - There is no `deleteAll`, no unscoped `deleteMany`, and no function that takes a
 *    raw `where` clause. A caller cannot express "delete everything".
 *  - `providerMessageId` and `acceptedAt` are written ONCE. `recordResult` refuses a
 *    row that already carries an id, so a provider acceptance cannot be overwritten
 *    or re-attributed.
 *
 * Tests use `deleteFixtures` with their own owner token. Nothing else deletes.
 */

export type QaOrigin = "LIVE" | "TEST_FIXTURE";

function inTestRunner(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

export class QaLedgerProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QaLedgerProtectionError";
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  label: string;
  origin: QaOrigin;
  fixtureOwner?: string | null;
  plannedCount?: number;
  note?: string | null;
  createdById?: string | null;
}

/**
 * Automated tests may not create LIVE records (ADR-0029).
 *
 * A LIVE row means "a real email was submitted to a real provider". A test never does
 * that — the transport registry refuses a live adapter under the runner — so a LIVE
 * row written by a test would be a false claim, and one that consumes a real
 * recipient's quota. Refused at the write.
 *
 * The meta-safety suite seeds a synthetic LIVE row through raw SQL, deliberately and
 * visibly, precisely because this path forbids it.
 */
function refuseLiveWritesUnderTest(origin: QaOrigin): void {
  if (origin === "LIVE" && inTestRunner()) {
    throw new QaLedgerProtectionError(
      "Automated tests may not create LIVE QA records. A LIVE row asserts that a real " +
        "email was sent, and consumes a real recipient's quota. Use origin TEST_FIXTURE.",
    );
  }
}

export async function createRun(input: CreateRunInput) {
  refuseLiveWritesUnderTest(input.origin);
  if (input.origin === "TEST_FIXTURE" && !input.fixtureOwner) {
    // Without an owner a fixture row could never be cleaned up, and would accumulate
    // in the operational database pretending to be somebody's test.
    throw new QaLedgerProtectionError(
      "A TEST_FIXTURE run must carry a fixtureOwner so its rows can be cleaned up.",
    );
  }
  if (input.origin === "LIVE" && input.fixtureOwner) {
    // The inverse matters more: a LIVE run carrying an owner token WOULD match a
    // fixture-scoped delete.
    throw new QaLedgerProtectionError(
      "A LIVE run must not carry a fixtureOwner — that would make it deletable by test cleanup.",
    );
  }

  return getPrisma().qaEmailRun.create({
    data: {
      label: input.label,
      origin: input.origin,
      fixtureOwner: input.fixtureOwner ?? null,
      plannedCount: input.plannedCount ?? 0,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

/** The newest OPEN live run, or null. Never creates one implicitly. */
export async function findOpenLiveRun() {
  return getPrisma().qaEmailRun.findFirst({
    where: { status: "OPEN", origin: "LIVE" },
    orderBy: [{ createdAt: "desc" }],
  });
}

let testFixtureOwner: string | undefined;

/**
 * Scopes fixture-run selection to ONE suite.
 *
 * Integration suites share a database and run in parallel workers, so "the newest
 * open fixture run" is ambiguous: two suites would each pick up the other's run,
 * write rows the other then cannot clean, and read counts the other is changing.
 * Pinning the owner makes each worker see only its own fixtures.
 *
 * Refuses outside the test runner, exactly like `setActorForTesting` — this must
 * never become a way to make real sends non-counting.
 */
export function setQaFixtureOwnerForTesting(owner: string | undefined): void {
  if (!inTestRunner()) {
    throw new QaLedgerProtectionError(
      "setQaFixtureOwnerForTesting is available only under the test runner.",
    );
  }
  testFixtureOwner = owner;
}

/**
 * The run a send should be attributed to.
 *
 * A LIVE run is used wherever one is open. A TEST_FIXTURE run is honoured ONLY under
 * the test runner — so a suite can exercise the whole send path end to end and have
 * its rows written as fixtures (cleanable, and invisible to the quota), while a
 * fixture run left behind in the operational database can never silently make a real
 * send stop counting.
 */
export async function findOpenRunForSending() {
  if (inTestRunner()) {
    // Under the test runner a send attaches ONLY to this worker's own pinned fixture
    // run — never to a LIVE run, even if one is open.
    //
    // Suites share a database and run in parallel. Without this, a LIVE run opened by
    // one suite's lifecycle test would silently make ANOTHER suite's sends LIVE:
    // rows that consume a real recipient's quota, that fixture cleanup cannot remove,
    // and that no test intended to create. Real sending never happens here anyway —
    // the transport registry refuses a live adapter under the runner.
    if (!testFixtureOwner) return null;
    return getPrisma().qaEmailRun.findFirst({
      where: { status: "OPEN", origin: "TEST_FIXTURE", fixtureOwner: testFixtureOwner },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  // In a real deployment only a LIVE run can carry a send. A fixture run, however it
  // got into the database, is never eligible.
  return findOpenLiveRun();
}

export async function closeRun(runId: string) {
  return getPrisma().qaEmailRun.update({
    where: { id: runId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
}

export async function listRuns(limit = 20) {
  return getPrisma().qaEmailRun.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { createdBy: { select: { email: true, name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

export interface CreateSendInput {
  runId: string;
  origin: QaOrigin;
  fixtureOwner?: string | null;
  recipient: string;
  subject: string;
  scenarioId: string;
  purpose: string;
  provider: string;
  requestedById?: string | null;
  ledgerRecovered?: boolean;
  recoveryNote?: string | null;
  providerMessageId?: string | null;
  state?: "SENDING" | "ACCEPTED" | "FAILED" | "UNCERTAIN";
  acceptedAt?: Date | null;
}

/**
 * Writes the attempt row BEFORE the provider call.
 *
 * A crash between here and the network still leaves evidence that a send was
 * attempted, which is the conservative direction: an attempt that may have been
 * delivered counts against the cap.
 */
export async function createSend(input: CreateSendInput) {
  refuseLiveWritesUnderTest(input.origin);
  if (input.origin === "LIVE" && input.fixtureOwner) {
    throw new QaLedgerProtectionError(
      "A LIVE send must not carry a fixtureOwner — that would make it deletable by test cleanup.",
    );
  }
  if (input.origin === "TEST_FIXTURE" && !input.fixtureOwner) {
    throw new QaLedgerProtectionError(
      "A TEST_FIXTURE send must carry a fixtureOwner so it can be cleaned up.",
    );
  }

  return getPrisma().qaEmailSend.create({
    data: {
      runId: input.runId,
      origin: input.origin,
      fixtureOwner: input.fixtureOwner ?? null,
      recipient: input.recipient,
      subject: input.subject,
      scenarioId: input.scenarioId,
      purpose: input.purpose,
      provider: input.provider,
      requestedById: input.requestedById ?? null,
      ledgerRecovered: input.ledgerRecovered ?? false,
      recoveryNote: input.recoveryNote ?? null,
      providerMessageId: input.providerMessageId ?? null,
      state: input.state ?? "SENDING",
      acceptedAt: input.acceptedAt ?? null,
    },
  });
}

export interface RecordResultInput {
  id: string;
  state: "ACCEPTED" | "FAILED" | "UNCERTAIN";
  providerMessageId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  acceptedAt?: Date | null;
}

/**
 * Records the provider's answer, ONCE.
 *
 * Refuses to touch a row that already carries a `providerMessageId`. A provider
 * acceptance is evidence that a specific message reached a specific inbox; letting a
 * later write replace it would make the ledger unable to answer "what was actually
 * sent?" — which is the only question it exists to answer.
 */
export async function recordResult(input: RecordResultInput) {
  const prisma = getPrisma();

  const existing = await prisma.qaEmailSend.findUnique({
    where: { id: input.id },
    select: { providerMessageId: true, state: true },
  });
  if (!existing) {
    throw new QaLedgerProtectionError("That QA send row does not exist.");
  }
  if (existing.providerMessageId !== null) {
    throw new QaLedgerProtectionError(
      "This QA send already has a provider message id. A provider acceptance is written once and never overwritten.",
    );
  }

  return prisma.qaEmailSend.update({
    where: { id: input.id },
    data: {
      state: input.state,
      providerMessageId: input.providerMessageId ?? null,
      failureCode: input.failureCode ?? null,
      failureReason: input.failureReason ?? null,
      acceptedAt: input.acceptedAt ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Counting — what the caps are computed from
// ---------------------------------------------------------------------------

/**
 * States that consume quota.
 *
 * `SENDING` and `UNCERTAIN` count. A message whose outcome is unknown may well have
 * been delivered, and quota must fail towards "we have sent enough" rather than
 * towards "send more". `FAILED` does not count: the provider definitively refused it,
 * so nobody received anything.
 */
export const QUOTA_STATES = ["SENDING", "ACCEPTED", "UNCERTAIN"] as const;

/**
 * Counts LIVE sends only.
 *
 * Fixture rows are excluded by the query, so a test that creates a hundred rows can
 * never consume a real recipient's quota — and equally, a test cannot pretend the
 * quota is empty.
 */
export async function countLiveSends(runId?: string): Promise<{
  total: number;
  perRecipient: Record<string, number>;
}> {
  const rows = await getPrisma().qaEmailSend.groupBy({
    by: ["recipient"],
    where: {
      origin: "LIVE",
      state: { in: [...QUOTA_STATES] },
      ...(runId ? { runId } : {}),
    },
    _count: true,
  });

  const perRecipient: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    perRecipient[row.recipient] = row._count;
    total += row._count;
  }
  return { total, perRecipient };
}

export async function listSends(runId?: string) {
  return getPrisma().qaEmailSend.findMany({
    where: runId ? { runId } : {},
    orderBy: [{ requestedAt: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Cleanup — the ONLY delete path, and it cannot reach a LIVE row
// ---------------------------------------------------------------------------

/**
 * Deletes rows belonging to ONE test fixture.
 *
 * There is deliberately no variant of this that takes a `where` clause, no
 * `deleteAll`, and no way to name a row by id. The filter always pins
 * `origin: TEST_FIXTURE` AND the caller's own owner token, so:
 *
 *   - a LIVE row cannot match, because its origin is LIVE and its owner is null;
 *   - another suite's fixture cannot match, because the owner differs.
 *
 * A caller that passes an empty owner is refused rather than matching everything —
 * the failure mode of `deleteMany({ fixtureOwner: undefined })` is precisely how the
 * original incident happened.
 */
export async function deleteFixtures(
  fixtureOwner: string,
): Promise<{ sends: number; runs: number }> {
  if (typeof fixtureOwner !== "string" || fixtureOwner.trim() === "") {
    throw new QaLedgerProtectionError(
      "deleteFixtures requires a non-empty fixture owner. An unscoped delete is not available.",
    );
  }

  const prisma = getPrisma();
  const owner = fixtureOwner.trim();

  const sends = await prisma.qaEmailSend.deleteMany({
    where: { origin: "TEST_FIXTURE", fixtureOwner: owner },
  });
  const runs = await prisma.qaEmailRun.deleteMany({
    where: { origin: "TEST_FIXTURE", fixtureOwner: owner },
  });

  return { sends: sends.count, runs: runs.count };
}
