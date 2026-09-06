import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), prisma: vi.fn() }));
vi.mock("../db/prisma", () => ({ getPrisma: mocks.prisma }));
vi.mock("./emailInfrastructureService", () => ({ readStoredDomainStatus: async () => ({
  status: { spf: "VERIFIED", dkim: "VERIFIED", dmarc: "UNKNOWN" }, checkedAt: new Date(),
}) }));
vi.mock("../integrations/email", () => ({
  productionSendingDomain: () => "axis-gps.com", productionDeliveryEnabled: () => true,
  getProductionEmailProvider: () => ({ checkConfiguration: () => ({ configured: true, enabled: true }), sendCustomer: vi.fn() }),
}));
vi.mock("./publicUrlConfig", () => ({ checkPublicUnsubscribeReadiness: () => ({ productionReady: true }) }));

import { getCustomerReleaseStatus } from "./productionDispatchService";

describe("customer release with outdated or unavailable scheduler storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries({ SCHEDULER_ENABLED: "true", SEND_MODE: "PRODUCTION",
      AXIS_DELIVERY_RELEASE_APPROVED: "true", PRODUCTION_DOMAIN_REVIEW_CONFIRMED: "true",
      RESEND_WEBHOOK_SECRET: "whsec_synthetic_only" })) vi.stubEnv(key, value);
    mocks.prisma.mockReturnValue({ schedulerHeartbeat: { findUnique: mocks.findUnique } });
    mocks.findUnique.mockResolvedValue({ lastTickAt: new Date() });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not touch scheduler storage when disabled, including a stale client", async () => {
    vi.stubEnv("SCHEDULER_ENABLED", "false");
    mocks.prisma.mockReturnValue({});
    expect((await getCustomerReleaseStatus()).enabled).toBe(false);
    expect(mocks.prisma).not.toHaveBeenCalled();
  });
  it("reports an outdated generated client as blocked instead of throwing TypeError", async () => {
    mocks.prisma.mockReturnValue({});
    const result = await getCustomerReleaseStatus();
    expect(result.enabled).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/regenerate Prisma and restart/);
  });
  it.each(["P2021", "P2022"])("reports missing migration %s as blocked", async code => {
    mocks.findUnique.mockRejectedValue({ code, message: "private database detail" });
    const result = await getCustomerReleaseStatus();
    expect(result.enabled).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/apply the release migrations/);
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });
  it("does not turn a database outage into permission to send or disclose diagnostics", async () => {
    mocks.findUnique.mockRejectedValue(new Error("private connection detail"));
    const result = await getCustomerReleaseStatus();
    expect(result.enabled).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/database access recovers/);
    expect(JSON.stringify(result)).not.toContain("private connection detail");
  });
  it.each([null, { lastTickAt: new Date(0) }])("requires a recent heartbeat: %j", async heartbeat => {
    mocks.findUnique.mockResolvedValue(heartbeat);
    expect((await getCustomerReleaseStatus()).enabled).toBe(false);
  });
  it("accepts a current heartbeat only when all independent release gates pass", async () => {
    expect(await getCustomerReleaseStatus()).toEqual({ enabled: true, blockers: [] });
  });
});
