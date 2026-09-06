import { expect, test } from "@playwright/test";

test("anonymous probes expose only health and do not widen public routes", async ({ request }) => {
  for (const endpoint of ["live", "ready"]) {
    const response = await request.get(`/api/health/${endpoint}`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    expect((await request.post(`/api/health/${endpoint}`)).status()).toBe(405);
  }
  const unrelated = await request.get("/api/health/config", { maxRedirects: 0 });
  expect(unrelated.status()).toBe(307);
  expect(unrelated.headers().location).toContain("/login");
});
