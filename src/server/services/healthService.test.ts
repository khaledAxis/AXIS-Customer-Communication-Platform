import { beforeEach, describe, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({ client: vi.fn(), database: vi.fn() }));
vi.mock("../db/prisma", () => ({ getPrisma: checks.client }));
vi.mock("../db/repositories/healthRepository", () => ({ databaseIsReady: checks.database }));

describe("health requires the running client as well as database migrations", () => {
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    checks.client.mockReturnValue({}); checks.database.mockResolvedValue(true);
  });
  it("refuses an incompatible client even after a successful cached database check", async () => {
    const { isApplicationReady } = await import("./healthService");
    expect(await isApplicationReady()).toBe(true);
    checks.client.mockImplementation(() => { throw new Error("stale generated client"); });
    expect(await isApplicationReady()).toBe(false);
    expect(checks.database).toHaveBeenCalledTimes(1);
  });
  it("does not query the database when the generated client cannot be used", async () => {
    checks.client.mockImplementation(() => { throw new Error("stale generated client"); });
    expect(await (await import("./healthService")).isApplicationReady()).toBe(false);
    expect(checks.database).not.toHaveBeenCalled();
  });
  it("still refuses missing migrations with a current client", async () => {
    checks.database.mockResolvedValue(false);
    expect(await (await import("./healthService")).isApplicationReady()).toBe(false);
  });
});
