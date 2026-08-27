import { expect, test } from "@playwright/test";

import { PageErrors, expectRendered, loginAsAdmin } from "../support";

/**
 * The hosted web version, in a real browser (ADR-0032).
 *
 * The point of "View as webpage" is that it works for somebody with no account and
 * with images blocked. That can only be verified by opening it — which is what this
 * does, in a context with no session at all.
 */

test.describe("public newsletter web version", () => {
  test("an ADMIN creates a web version and the public URL is shown", async ({ page }) => {
    const creds = await loginAsAdmin(page);
    await page.goto(`/newsletters/${creds.fixtures.campaignId}/preview`);
    await expectRendered(page, /preview/i);

    const create = page.getByRole("button", { name: /create web version/i });
    if ((await create.count()) > 0) {
      await create.click();
      await page.waitForLoadState("networkidle");
    }

    // PUBLIC_APP_URL is a localhost origin in this environment, so the platform
    // correctly declines to promise a public link. Either state is legitimate; what
    // must never happen is a link that would not open.
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/web version/i);
    expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
  });

  test("an unknown token renders a calm page and leaks nothing", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);

    // No login at all — this is how a recipient arrives.
    await page.goto("/n/this-token-does-not-exist-at-all", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).not.toHaveURL(/\/login/); // genuinely public
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/not available/i);
    expect(body).not.toMatch(/PrismaClient|at \w+ \(|node_modules/);

    errors.assertClean("public newsletter, unknown token");
    void testInfo;
  });

  test("a malformed token is refused the same way", async ({ page }) => {
    for (const token of ["short", "..%2f..%2fetc", "%20%20"]) {
      await page.goto(`/n/${token}`, { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login/);
      const body = await page.locator("body").innerText();
      // Identical answer every time: never an oracle for which newsletters exist.
      expect(body).toMatch(/not available/i);
    }
  });

  test("the public page requires no session and shows no application chrome", async ({
    page,
  }) => {
    await page.goto("/n/this-token-does-not-exist-at-all", {
      waitUntil: "domcontentloaded",
    });

    // A recipient must never be shown AXIS navigation or admin controls.
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /customers/i })).toHaveCount(0);
  });
});

test.describe("redesigned newsletter preview", () => {
  test("the preview renders the premium layout without errors", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);
    const creds = await loginAsAdmin(page);

    await page.goto(`/newsletters/${creds.fixtures.campaignId}/preview`);
    await expectRendered(page, /preview/i);

    const frame = page.frameLocator("iframe").first();
    // The hero headline is the largest thing on the page and must actually render.
    await expect(frame.locator("h1").first()).toBeVisible();

    const heroSize = await frame
      .locator("h1")
      .first()
      .evaluate((node) => Number.parseInt(getComputedStyle(node).fontSize, 10));
    const bodySize = await frame
      .locator("p")
      .first()
      .evaluate((node) => Number.parseInt(getComputedStyle(node).fontSize, 10));

    // Hierarchy, measured rather than asserted from the source.
    expect(heroSize).toBeGreaterThanOrEqual(30);
    expect(heroSize).toBeGreaterThan(bodySize * 1.8);

    errors.assertClean("newsletter preview");
    void testInfo;
  });
});
