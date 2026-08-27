import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  assertTestDatabaseTarget,
  describeDatabaseTarget,
} from "../../domain/infra/databaseTarget";

/**
 * Lazily-constructed Prisma client singleton.
 *
 * Prisma 7 + PostgreSQL requires a driver adapter (`@prisma/adapter-pg`). The client is
 * created on first use so that merely importing this module never throws when
 * `DATABASE_URL` is absent (e.g. during typecheck/build).
 *
 * DATABASE SELECTION IS DECIDED HERE, ONCE (ADR-0029).
 *
 * Automated tests ran against `axis_ccp_dev` — the operational development database,
 * holding mirrored Monday CRM, real staff accounts, consent decisions and the QA send
 * ledger — and a fixture cleanup deleted live records from it. The fix is not a more
 * careful cleanup: it is that a test process cannot obtain a client pointed at the
 * operational database at all.
 *
 * So the resolution is explicit rather than a hidden `process.env` swap performed
 * somewhere earlier:
 *
 *   under the test runner  →  TEST_DATABASE_URL, guarded, or THROW
 *   otherwise              →  DATABASE_URL
 *
 * It FAILS CLOSED. A missing `TEST_DATABASE_URL` does not fall back to `DATABASE_URL`;
 * it throws, and the message says why.
 */
let client: PrismaClient | undefined;

const globalForPrisma = globalThis as unknown as {
  __axisPrisma?: PrismaClient;
};

export function inTestRunner(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

export class OperationalDatabaseInTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalDatabaseInTestError";
  }
}

/**
 * The connection string this process is permitted to use.
 *
 * Exported so a meta-safety test can assert the decision directly rather than
 * inferring it from behaviour.
 */
export function resolveDatabaseUrl(): string {
  if (inTestRunner()) {
    const testUrl = process.env.TEST_DATABASE_URL;
    const verdict = assertTestDatabaseTarget(testUrl);

    if (!verdict.ok) {
      // Deliberately NOT repaired and deliberately NOT defaulted. A test process that
      // cannot name a safe database must stop.
      throw new OperationalDatabaseInTestError(
        `${verdict.message}\n` +
          "Automated tests are not allowed to use the AXIS operational development database.",
      );
    }
    return testUrl as string;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — configure a PostgreSQL connection in .env.local before using the database.",
    );
  }
  return connectionString;
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.__axisPrisma) return globalForPrisma.__axisPrisma;
  if (client) return client;

  const connectionString = resolveDatabaseUrl();

  const adapter = new PrismaPg({ connectionString });
  client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__axisPrisma = client;
  }
  return client;
}

/** Safe, credential-free description of the active target, for diagnostics. */
export function describeActiveDatabase(): string {
  try {
    return describeDatabaseTarget(resolveDatabaseUrl());
  } catch (error) {
    return error instanceof Error ? `unavailable (${error.name})` : "unavailable";
  }
}
