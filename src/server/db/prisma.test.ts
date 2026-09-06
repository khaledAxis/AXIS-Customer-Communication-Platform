import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const fixture = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[], missingFreshDelegate: "", outdatedGeneratedModel: false,
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("@prisma/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return { ...actual, Prisma: { ...actual.Prisma,
    get dmmf() {
      const dmmf = actual.Prisma.dmmf;
      return fixture.outdatedGeneratedModel ? { ...dmmf, datamodel: { ...dmmf.datamodel,
        models: dmmf.datamodel.models.filter(model => model.name !== "ProviderWebhookReceipt"),
      } } : dmmf;
    },
  }, PrismaClient: vi.fn(function () {
    const client: Record<string, unknown> = Object.fromEntries(Object.values(actual.Prisma.ModelName).map(name => [
      name[0].toLowerCase() + name.slice(1), { count: vi.fn(), findUnique: vi.fn() },
    ]));
    client.$disconnect = vi.fn(async () => undefined);
    delete client[fixture.missingFreshDelegate];
    fixture.created.push(client);
    return client;
  }) };
});

const globals = globalThis as unknown as {
  __axisPrisma?: PrismaClient;
  __axisPrismaCache?: { client: PrismaClient; identity: string };
};
let saved: Pick<typeof globals, "__axisPrisma" | "__axisPrismaCache">;

describe("Prisma singleton compatibility across hot reloads", () => {
  beforeEach(() => {
    saved = { __axisPrisma: globals.__axisPrisma, __axisPrismaCache: globals.__axisPrismaCache };
    delete globals.__axisPrisma; delete globals.__axisPrismaCache;
    vi.resetModules();
    fixture.created.length = 0; fixture.missingFreshDelegate = ""; fixture.outdatedGeneratedModel = false;
  });
  afterEach(() => {
    globals.__axisPrisma = saved.__axisPrisma; globals.__axisPrismaCache = saved.__axisPrismaCache;
    vi.unstubAllEnvs();
  });

  it("keeps one compatible client across module reloads", async () => {
    const first = (await import("./prisma")).getPrisma();
    vi.resetModules();
    expect((await import("./prisma")).getPrisma()).toBe(first);
    expect(fixture.created).toHaveLength(1);
    expect(first.$disconnect).not.toHaveBeenCalled();
  });
  it("replaces the unversioned legacy global instead of returning it to Reports", async () => {
    const legacy = { $disconnect: vi.fn(async () => undefined), campaign: {} } as unknown as PrismaClient;
    globals.__axisPrisma = legacy;
    const current = (await import("./prisma")).getPrisma();
    expect(current).not.toBe(legacy);
    expect(typeof current.providerWebhookReceipt.count).toBe("function");
    expect(legacy.$disconnect).toHaveBeenCalledTimes(1);
    expect(globals.__axisPrisma).toBeUndefined();
  });
  it.each(["providerWebhookReceipt", "schedulerHeartbeat", "backgroundJob", "jobSchedule", "mondayWebhookEvent"])("replaces a cached client missing %s", async delegate => {
    const { getPrisma } = await import("./prisma");
    const first = getPrisma();
    Reflect.deleteProperty(first, delegate);
    const current = getPrisma();
    expect(current).not.toBe(first);
    expect(Reflect.get(current, delegate)).toBeDefined();
    expect(first.$disconnect).toHaveBeenCalledTimes(1);
    expect(getPrisma()).toBe(current);
    expect(fixture.created).toHaveLength(2);
  });
  it("replaces a cache stamped for a different model fingerprint", async () => {
    const { getPrisma } = await import("./prisma");
    const first = getPrisma();
    globals.__axisPrismaCache!.identity = "previous-generated-schema";
    expect(getPrisma()).not.toBe(first);
    expect(first.$disconnect).toHaveBeenCalledTimes(1);
  });
  it("never lets a warm cache bypass the operational-database test guard", async () => {
    const { getPrisma, OperationalDatabaseInTestError } = await import("./prisma");
    getPrisma();
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://fixture:synthetic@localhost:5432/axis_ccp_dev");
    expect(() => getPrisma()).toThrow(OperationalDatabaseInTestError);
    expect(fixture.created).toHaveLength(1);
  });
  it("does not reuse a connection when the guarded test target changes", async () => {
    const { getPrisma } = await import("./prisma");
    const first = getPrisma();
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://fixture:synthetic@localhost:5432/another_test");
    expect(getPrisma()).not.toBe(first);
    expect(first.$disconnect).toHaveBeenCalledTimes(1);
    expect(globals.__axisPrismaCache!.identity).not.toContain("postgresql");
    expect(globals.__axisPrismaCache!.identity).not.toContain("synthetic");
  });
  it("rejects old generated model metadata before constructing a client", async () => {
    fixture.outdatedGeneratedModel = true;
    const { getPrisma, StalePrismaClientError } = await import("./prisma");
    expect(() => getPrisma()).toThrow(StalePrismaClientError);
    expect(fixture.created).toHaveLength(0);
  });
  it("does not cache or return a freshly constructed but incomplete client", async () => {
    fixture.missingFreshDelegate = "providerWebhookReceipt";
    const { getPrisma } = await import("./prisma");
    expect(() => getPrisma()).toThrow(/npm run db:generate/);
    expect(globals.__axisPrismaCache).toBeUndefined();
    expect(fixture.created[0].$disconnect).toHaveBeenCalledTimes(1);
  });
});
