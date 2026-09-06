import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../src/server/db/prisma";
import { getDeliveryReport } from "../../src/server/services/reportService";
import { getJobOperations } from "../../src/server/services/jobService";
import { actAs, clearTestActor, createTestUser, type TestUser } from "../support/actor";

let actor: TestUser;
beforeAll(async () => {
  actor = await createTestUser({ prefix: "prisma-cache-recovery", role: "MANAGER" });
});
beforeEach(() => actAs(actor));
afterAll(async () => {
  clearTestActor();
  if (actor) await getPrisma().user.delete({ where: { id: actor.id } });
});

it("renders actual report data after replacing a cached client without the receipt delegate", async () => {
  const previous = getPrisma();
  const shared = globalThis as unknown as {
    __axisPrismaCache: { client: PrismaClient; identity: string };
  };
  let retired = 0;
  // Simulate the legacy shape while retaining ownership of its actual pool so the
  // recovery path must close it. The report still executes against synthetic Postgres.
  shared.__axisPrismaCache.client = { $disconnect: async () => {
    retired++; await previous.$disconnect();
  } } as unknown as PrismaClient;
  const report = await getDeliveryReport();
  expect(report.unmatched).toBeGreaterThanOrEqual(0);
  expect(report.total).toBeGreaterThanOrEqual(0);
  expect(report.metrics.prepared).toBeGreaterThanOrEqual(0);
  expect(retired).toBe(1);
  expect(typeof getPrisma().providerWebhookReceipt.count).toBe("function");
});

it("loads Operations after replacing a cached client missing jobSchedule", async () => {
  const previous = getPrisma();
  const shared = globalThis as unknown as {
    __axisPrismaCache: { client: PrismaClient; identity: string };
  };
  let retired = 0;
  shared.__axisPrismaCache.client = new Proxy(previous, {
    get(target, property) {
      if (property === "jobSchedule") return undefined;
      if (property === "$disconnect") return async () => {
        retired++; await previous.$disconnect();
      };
      return Reflect.get(target, property);
    },
  });
  const operations = await getJobOperations();
  expect(operations.jobs).toBeInstanceOf(Array);
  expect(operations.webhookCounts).toBeInstanceOf(Array);
  expect(operations.schedule === null || operations.schedule.key === "CRM_RECONCILIATION").toBe(true);
  expect(retired).toBe(1);
  expect(typeof getPrisma().jobSchedule.findUnique).toBe("function");
});
