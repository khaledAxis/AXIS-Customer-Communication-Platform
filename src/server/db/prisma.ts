import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolSettings } from "../../domain/infra/poolSettings";
import migrations from "./migration-manifest.json";

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
interface ClientCacheEntry {
  client: PrismaClient;
  identity: string;
}

let cache: ClientCacheEntry | undefined;

const globalForPrisma = globalThis as unknown as {
  __axisPrismaCache?: ClientCacheEntry;
  /** Previous releases cached an unversioned client here. Never reuse it. */
  __axisPrisma?: PrismaClient;
};

// The generated model/field shape changes even when the Prisma package version does
// not. A migration-manifest change also invalidates a client retained through HMR.
const modelFingerprint = createHash("sha256").update(JSON.stringify({
  version: Prisma.prismaVersion.client, datamodel: Prisma.dmmf.datamodel, migrations,
})).digest("hex");
const delegateNames = Object.values(Prisma.ModelName).map(name => name[0].toLowerCase() + name.slice(1));
const workflowFields = {
  Campaign: ["dispatchDocument", "dispatchApprovalId", "deliveryConfirmedCount"],
  AuthRateLimit: ["key"], BackgroundJob: ["leaseToken"], JobSchedule: ["nextRunAt"],
  SchedulerHeartbeat: ["lastTickAt"], ProviderRateLimit: ["nextAvailableAt"],
  ProviderWebhookReceipt: ["normalizedEvent", "processedAt"],
  ContentTranslation: ["sourceHash", "generatedContentItemId", "state"],
} as const;

/** Check the generated module too: a fresh instance of old generated code is still old. */
const generatedWorkflowModelsPresent = Object.entries(workflowFields).every(([name, fields]) => {
  const model = Prisma.dmmf.datamodel.models.find(item => item.name === name);
  return model && fields.every(field => model.fields.some(item => item.name === field));
});

export class StalePrismaClientError extends Error {
  constructor() {
    super("The server database client is outdated. Stop Next.js, run npm run db:generate, clear the .next/dev cache, and restart with npm run dev. Database migrations remain a separate release step.");
    this.name = "StalePrismaClientError";
  }
}

function hasCurrentDelegates(candidate: PrismaClient): boolean {
  // A runtime compatibility check intentionally does not trust the compile-time type.
  const delegates = candidate as unknown as Record<string, { count?: unknown; findUnique?: unknown } | undefined>;
  return delegateNames.every(name => typeof delegates[name]?.count === "function" && typeof delegates[name]?.findUnique === "function");
}

function retireClient(candidate: PrismaClient) {
  // Drain superseded adapters without leaking a new pool on every hot reload. Never
  // serialize a disconnect error: adapter diagnostics can include connection details.
  void candidate.$disconnect().catch(() => undefined);
}

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
  // Validate the target BEFORE consulting any cache, including inside a test runner.
  const connectionString = resolveDatabaseUrl();
  if (!generatedWorkflowModelsPresent) throw new StalePrismaClientError();
  const settings = databasePoolSettings(process.env);
  // Only the opaque digest is retained with the cache, never a second raw URL.
  const identity = createHash("sha256").update(JSON.stringify({ modelFingerprint, connectionString, settings })).digest("hex");
  const shared = process.env.NODE_ENV !== "production";
  const existing = shared ? globalForPrisma.__axisPrismaCache ?? cache : cache;
  if (existing?.identity === identity && hasCurrentDelegates(existing.client)) return existing.client;

  const adapter = new PrismaPg({ connectionString, ...settings });
  const fresh = new PrismaClient({ adapter });
  if (!hasCurrentDelegates(fresh)) {
    retireClient(fresh);
    throw new StalePrismaClientError();
  }
  const retired = new Set([existing?.client, cache?.client, globalForPrisma.__axisPrisma]);
  cache = { client: fresh, identity };
  if (shared) globalForPrisma.__axisPrismaCache = cache;
  delete globalForPrisma.__axisPrisma;
  for (const previous of retired) if (previous && previous !== fresh) retireClient(previous);
  return fresh;
}

/** Safe, credential-free description of the active target, for diagnostics. */
export function describeActiveDatabase(): string {
  try {
    return describeDatabaseTarget(resolveDatabaseUrl());
  } catch (error) {
    return error instanceof Error ? `unavailable (${error.name})` : "unavailable";
  }
}
