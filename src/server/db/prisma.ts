import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Lazily-constructed Prisma client singleton.
 *
 * Prisma 7 + PostgreSQL requires a driver adapter (`@prisma/adapter-pg`). The
 * client is created on first use so that merely importing this module never
 * throws when `DATABASE_URL` is absent (e.g. during typecheck/build or when the
 * database has not been provisioned yet). Integration tests call `getPrisma()`
 * only when a `DATABASE_URL` is configured.
 */
let client: PrismaClient | undefined;

const globalForPrisma = globalThis as unknown as {
  __axisPrisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  if (globalForPrisma.__axisPrisma) return globalForPrisma.__axisPrisma;
  if (client) return client;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — configure a PostgreSQL connection in .env.local before using the database.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__axisPrisma = client;
  }
  return client;
}
