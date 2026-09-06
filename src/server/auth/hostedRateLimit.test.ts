import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { consumeLoginAttempt } from "./hostedRateLimit";
import { consumeSharedAttempt, pruneExpiredAttempts } from "../db/repositories/authRateLimitRepository";

vi.mock("../db/repositories/authRateLimitRepository", () => ({
  consumeSharedAttempt: vi.fn(), pruneExpiredAttempts: vi.fn().mockResolvedValue(undefined),
  releaseSharedAttempt: vi.fn(),
}));
beforeEach(() => {
  vi.stubEnv("AXIS_HOSTED", "true");
  vi.stubEnv("AUTH_SECRET", "synthetic-operations-secret-at-least-32-characters");
  vi.mocked(consumeSharedAttempt).mockReset();
  vi.mocked(pruneExpiredAttempts).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("fails closed on shared-store failure and never falls back to a local allowance", async () => {
  vi.mocked(consumeSharedAttempt).mockRejectedValue(new Error("unavailable"));
  expect(await consumeLoginAttempt("staff@axis-test.invalid")).toBe(false);
});
it("stores an opaque stable key rather than the submitted email", async () => {
  vi.mocked(consumeSharedAttempt).mockResolvedValue(true);
  expect(await consumeLoginAttempt("Staff@axis-test.invalid")).toBe(true);
  expect(await consumeLoginAttempt("staff@axis-test.invalid")).toBe(true);
  const [first, second] = vi.mocked(consumeSharedAttempt).mock.calls;
  expect(first[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(first[0]).toBe(second[0]);
});
it("missing shared key material refuses login before touching the store", async () => {
  vi.stubEnv("AUTH_SECRET", "");
  expect(await consumeLoginAttempt("staff@axis-test.invalid")).toBe(false);
  expect(consumeSharedAttempt).not.toHaveBeenCalled();
});
it("housekeeping cannot relax a denied login", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
  vi.mocked(consumeSharedAttempt).mockResolvedValue(false);
  vi.mocked(pruneExpiredAttempts).mockRejectedValueOnce(new Error("unavailable"));
  expect(await consumeLoginAttempt("staff@axis-test.invalid")).toBe(false);
  expect(pruneExpiredAttempts).toHaveBeenCalledOnce();
});
