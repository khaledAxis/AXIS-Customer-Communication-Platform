import "server-only";
import { getPrisma } from "../prisma";

/** One SQL statement serializes attempts across replicas using the primary key lock. */
export async function consumeSharedAttempt(key: string, limit: number, windowMs: number): Promise<boolean> {
  const rows = await getPrisma().$queryRaw<{ attempts: number }[]>`
    INSERT INTO "AuthRateLimit" ("key", "attempts", "expiresAt", "createdAt", "updatedAt")
    VALUES (${key}, 1, NOW() + ${windowMs} * INTERVAL '1 millisecond', NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "AuthRateLimit"."expiresAt" <= NOW() THEN 1
        ELSE LEAST("AuthRateLimit"."attempts" + 1, ${limit + 1}) END,
      "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= NOW()
        THEN NOW() + ${windowMs} * INTERVAL '1 millisecond' ELSE "AuthRateLimit"."expiresAt" END,
      "updatedAt" = NOW()
    RETURNING "attempts"
  `;
  return rows[0]?.attempts <= limit;
}

export async function releaseSharedAttempt(key: string) {
  await getPrisma().authRateLimit.deleteMany({ where: { key } });
}

/** Bounded cleanup; expiry remains enforced at consumption even if this never runs. */
export async function pruneExpiredAttempts() {
  await getPrisma().$executeRaw`
    DELETE FROM "AuthRateLimit" WHERE "key" IN
      (SELECT "key" FROM "AuthRateLimit" WHERE "expiresAt" < NOW() ORDER BY "expiresAt" LIMIT 1000)
  `;
}
