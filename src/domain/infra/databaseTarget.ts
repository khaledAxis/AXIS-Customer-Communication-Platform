/**
 * Which database a process is permitted to use (ADR-0029).
 *
 * This exists because of a real incident: automated tests ran against
 * `axis_ccp_dev` — the operational development database holding mirrored Monday CRM,
 * real AXIS staff accounts, consent decisions and the QA send ledger — and a fixture
 * cleanup deleted live records from it.
 *
 * The lesson is not "write more careful cleanups". It is that a test process must be
 * *incapable* of naming the operational database at all. This module is the pure
 * decision function for that: it takes a connection string and answers whether a test
 * process may use it.
 *
 * It FAILS CLOSED. An unreadable URL, a missing name, an unrecognised name and an
 * absent configuration are all refusals. There is deliberately no "probably fine"
 * branch, and no code path that repairs a URL into an acceptable one — a process that
 * pointed at the wrong database must stop, not be redirected.
 *
 * Pure: no I/O, no Prisma, no framework imports.
 */

/** The only database an automated test may use. */
export const TEST_DATABASE_NAME = "axis_ccp_test" as const;

/** The operational database. Named so the refusal can say why. */
export const OPERATIONAL_DATABASE_NAME = "axis_ccp_dev" as const;

export type DatabaseTargetProblem =
  | "NOT_CONFIGURED"
  | "MALFORMED"
  | "NO_DATABASE_NAME"
  | "OPERATIONAL_DATABASE"
  | "NOT_A_TEST_DATABASE";

export const DATABASE_TARGET_MESSAGE: Record<DatabaseTargetProblem, string> = {
  NOT_CONFIGURED:
    "TEST_DATABASE_URL is not set. Database integration tests refuse to run rather than " +
    "fall back to the operational development database. Add TEST_DATABASE_URL to .env.local.",
  MALFORMED: "TEST_DATABASE_URL is not a valid PostgreSQL connection string.",
  NO_DATABASE_NAME: "TEST_DATABASE_URL does not name a database.",
  OPERATIONAL_DATABASE:
    "Automated tests are not allowed to use the AXIS operational development database.",
  NOT_A_TEST_DATABASE:
    `Automated tests may only use a test database. The name must be "${TEST_DATABASE_NAME}" ` +
    `or end in "_test".`,
};

export type DatabaseTargetResult =
  | { ok: true; databaseName: string; host: string; port: string }
  | { ok: false; problem: DatabaseTargetProblem; message: string };

/** The database name from a PostgreSQL URL, or null when there isn't one. */
export function databaseNameOf(connectionString: unknown): string | null {
  if (typeof connectionString !== "string" || connectionString.trim() === "") return null;
  try {
    const url = new URL(connectionString.trim());
    const name = url.pathname.replace(/^\//, "").trim();
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

/**
 * Whether a database name is acceptable for automated tests.
 *
 * `axis_ccp_dev` is rejected BY NAME as well as by the general rule, so the refusal
 * can explain itself — "that is the operational database" is more useful to somebody
 * debugging than "that name does not end in _test".
 */
export function isTestDatabaseName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const value = name.trim().toLowerCase();
  if (value === "") return false;
  if (value === OPERATIONAL_DATABASE_NAME) return false;
  return value === TEST_DATABASE_NAME || value.endsWith("_test");
}

/**
 * Judges a connection string a test process wants to use.
 *
 * Called before ANY fixture creation, cleanup, mutation or migration reset. A refusal
 * here is intended to stop the process, not to be caught and worked around.
 */
export function assertTestDatabaseTarget(
  connectionString: unknown,
): DatabaseTargetResult {
  const fail = (problem: DatabaseTargetProblem): DatabaseTargetResult => ({
    ok: false,
    problem,
    message: DATABASE_TARGET_MESSAGE[problem],
  });

  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return fail("NOT_CONFIGURED");
  }

  let url: URL;
  try {
    url = new URL(connectionString.trim());
  } catch {
    return fail("MALFORMED");
  }

  if (!url.protocol.startsWith("postgres")) return fail("MALFORMED");

  const name = url.pathname.replace(/^\//, "").trim();
  if (name === "") return fail("NO_DATABASE_NAME");

  // Named explicitly so the message can be specific about what went wrong.
  if (name.toLowerCase() === OPERATIONAL_DATABASE_NAME) {
    return fail("OPERATIONAL_DATABASE");
  }
  if (!isTestDatabaseName(name)) return fail("NOT_A_TEST_DATABASE");

  return {
    ok: true,
    databaseName: name,
    host: url.hostname,
    port: url.port === "" ? "5432" : url.port,
  };
}

/**
 * A connection description safe to print at test startup.
 *
 * Deliberately reconstructed from parts rather than redacted from the original: a
 * redaction that misses a case leaks a password, whereas a value built only from the
 * host, port and database name cannot contain one.
 */
export function describeDatabaseTarget(connectionString: unknown): string {
  const result = assertTestDatabaseTarget(connectionString);
  if (!result.ok) return `unusable (${result.problem})`;
  return `${result.databaseName} @ ${result.host}:${result.port}`;
}
