import { Client } from "pg";
import { assertTestDatabaseTarget } from "../../src/domain/infra/databaseTarget";
import { inTestRunner } from "../../src/server/db/prisma";

/**
 * QA quota is intentionally lifetime-wide, so owner-scoped rows alone cannot isolate
 * suites that seed synthetic LIVE evidence from suites exercising the send gate.
 * Hold one test-database session lock until this suite has cleaned up its own rows.
 * Other integration suites and concurrent sends within a suite still run in parallel.
 */
export async function acquireQaQuotaTestLock(): Promise<() => Promise<void>> {
  const connectionString = process.env.TEST_DATABASE_URL;
  const verdict = assertTestDatabaseTarget(connectionString);
  if (!inTestRunner() || !verdict.ok) throw new Error("QA fixture locking requires a guarded test database.");
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SET lock_timeout = '8s'");
    await client.query("SELECT pg_advisory_lock(1096304979, 1363234645)");
    // Closing the owning session releases the lock, including on failed test cleanup.
    return () => client.end();
  } catch (error) {
    await client.end();
    throw error;
  }
}
