import { expect, test } from "@playwright/test";
import { credentials, loginAsAdmin, PageErrors } from "../support";

test("reports support date filtering, recipient drilldown and authenticated CSV export", async ({ page }) => {
  await loginAsAdmin(page); const errors = new PageErrors(page);
  await page.goto("/reports");
  await page.getByLabel("Campaigns created from (UTC)").fill("2026-02-01");
  await page.getByLabel("Through (UTC)").fill("2026-02-02");
  await page.getByRole("button",{name:"Apply dates"}).click();
  await expect(page).toHaveURL(/from=2026-02-01/);
  const id = credentials().fixtures.campaignId;
  await page.goto(`/reports/${id}`); await expect(page.getByRole("heading",{name:/recipient outcomes/i})).toBeVisible();
  const response = await page.request.get(`/api/reports/${id}/export`);
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).toContain('"Accepted UTC"'); errors.assertClean("Delivery reporting");
});

test("scheduler and Monday routes reject unauthenticated work without exposing data", async ({ request }) => {
  for (const route of ["/api/internal/jobs/tick","/api/webhooks/monday"]) {
    const response=await request.post(route,{data:{event:{boardId:123}},maxRedirects:0});
    expect([401,503]).toContain(response.status()); expect(await response.text()).not.toMatch(/@|campaignId|actorUserId/);
  }
  expect((await request.get("/api/reports/unknown/export",{maxRedirects:0})).status()).toBe(307);
});

test("customer delivery stays locked and shows the actual message for review", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/newsletters/${credentials().fixtures.campaignId}/readiness`);
  await expect(page.getByRole("button",{name:"Schedule customer delivery"})).toBeDisabled();
  await expect(page.getByText("Production customer sending has not been enabled.",{exact:true})).toBeVisible();
  await expect(page.locator("iframe")).toBeVisible();
});
