import "server-only";
import { Pool } from "pg";
import { resolveDatabaseUrl } from "../prisma";
import { migrationsReady, type AppliedMigration } from "../../../domain/infra/migrationReadiness";
import expected from "../migration-manifest.json";

// A separate, bounded connection keeps a health probe from exhausting the business pool.
let pool: Pool | undefined;
export async function databaseIsReady(): Promise<boolean> {
  pool ??= new Pool({
    connectionString: resolveDatabaseUrl(), max: 1, connectionTimeoutMillis: 1000,
    query_timeout: 1500, statement_timeout: 1500, idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
  // Idle socket failures must not become an uncaught EventEmitter error.
  if (!pool.listenerCount("error")) pool.on("error", () => undefined);
  const result = await pool.query<AppliedMigration>(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
  );
  return migrationsReady(expected, result.rows);
}

