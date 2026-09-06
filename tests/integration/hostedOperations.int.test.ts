import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../../src/server/db/prisma";
import { consumeSharedAttempt, releaseSharedAttempt } from "../../src/server/db/repositories/authRateLimitRepository";
import { databaseIsReady } from "../../src/server/db/repositories/healthRepository";

const keys: string[] = [];
afterEach(async () => {
  await getPrisma().authRateLimit.deleteMany({ where: { key: { in: keys.splice(0) } } });
});
describe("hosted operations", () => {
  it("permits exactly eight concurrent attempts for one identity", async () => {
    const key = randomUUID(); keys.push(key);
    const results = await Promise.all(Array.from({length:24},() => consumeSharedAttempt(key,8,60000)));
    expect(results.filter(Boolean)).toHaveLength(8);
    expect(await consumeSharedAttempt(key,8,60000)).toBe(false);
    await releaseSharedAttempt(key);
    expect(await consumeSharedAttempt(key,8,60000)).toBe(true);
  });
  it("starts a new window after expiry without requiring a cleanup job", async () => {
    const key = randomUUID(); keys.push(key);
    await getPrisma().authRateLimit.create({data:{key,attempts:9,expiresAt:new Date(0)}});
    expect(await consumeSharedAttempt(key,8,60000)).toBe(true);
  });
  it("readiness validates the migrated test database", async () => {
    expect(await databaseIsReady()).toBe(true);
  });
});

