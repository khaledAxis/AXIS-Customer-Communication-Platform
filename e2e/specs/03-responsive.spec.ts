import { expect, test } from "@playwright/test";

import { expectRendered, loginAsAdmin } from "../support";

/**
 * Mobile viewport sanity, plus practical accessibility checks (ADR-0031, §40/§41).
 *
 * Not a WCAG certification. It looks for the defects that actually make a screen
 * unusable: content wider than the viewport, form controls with no accessible name,
 * and buttons a screen reader would announce as nothing at all.
 */

const PAGES = [
  { path: "/", heading: /welcome to axis/i },
  { path: "/content/inbox", heading: /review inbox/i },
  { path: "/sources", heading: /content sources/i },
  { path: "/automations", heading: /automations/i },
  { path: "/reports", heading: /reports/i },
  { path: "/operations", heading: /operations/i },
  { path: "/admin/qa-email/review", heading: /qa rendering review/i },
];

test.describe("mobile viewport", () => {
  for (const target of PAGES) {
    test(`${target.path} has no horizontal overflow on a phone`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(target.path);
      await expectRendered(page, target.heading);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });

      // A few pixels of rounding is normal; a genuinely wider page is not.
      expect(
        overflow.scrollWidth - overflow.clientWidth,
        `${target.path} overflows horizontally on mobile`,
      ).toBeLessThanOrEqual(2);
    });
  }

  test("navigation is reachable on a phone", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    await expect(page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Newsletters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i }).first()).toBeVisible();
  });

  test("workspace search navigates and nested pages have one active link", async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: /go to a page/i }).click();
    const dialog = page.getByRole("dialog", { name: "Go to a page" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill("review inbox");
    await dialog.getByRole("link", { name: /review inbox/i }).click();
    await expect(page).toHaveURL(/\/content\/inbox$/);
    await expect(dialog).not.toBeVisible();
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Review inbox");
    if (await page.getByRole("button", { name: "Close navigation" }).isVisible()) {
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
  });

  test("page search supports empty results, keyboard dismissal, and focus return", async ({ page }) => {
    await loginAsAdmin(page);
    const trigger = page.getByRole("button", { name: /go to a page/i });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("no-such-workspace-page");
    await expect(dialog.getByText(/no pages found/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
  });

  test("newsletter filters survive reload and can be cleared", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/newsletters");
    await page.getByRole("searchbox", { name: "Search newsletters" }).fill("no-newsletter-with-this-name");
    await page.getByRole("combobox", { name: "Newsletter status" }).selectOption("DRAFT");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No matching newsletters" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("searchbox")).toHaveValue("no-newsletter-with-this-name");
    await expect(page.getByRole("combobox", { name: "Newsletter status" })).toHaveValue("DRAFT");
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("");
  });

  test("workspace visual review", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
    await loginAsAdmin(page);
    for (const [name, path] of [["dashboard", "/"], ["content", "/content"], ["newsletters", "/newsletters"], ["reports", "/reports"], ["operations", "/operations"]]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} should fit the viewport`).toBeLessThanOrEqual(2);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: name !== "content" });
    }
  });
});

test.describe("accessibility sanity", () => {
  test("every form control on the source form has an accessible name", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");

    const unnamed = await page.evaluate(() => {
      const problems: string[] = [];
      for (const field of Array.from(
        document.querySelectorAll("input, select, textarea"),
      )) {
        const element = field as HTMLInputElement;
        if (element.type === "hidden") continue;
        const labelled =
          element.labels?.length ||
          element.getAttribute("aria-label") ||
          element.getAttribute("aria-labelledby") ||
          element.getAttribute("title");
        if (!labelled) problems.push(element.name || element.outerHTML.slice(0, 60));
      }
      return problems;
    });

    expect(unnamed, "form controls without an accessible name").toEqual([]);
  });

  test("no button is announced as empty", async ({ page }) => {
    await loginAsAdmin(page);

    for (const path of ["/", "/content/inbox", "/sources", "/automations"]) {
      await page.goto(path);
      const nameless = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("button"))
          .filter((button) => {
            const text = (button.textContent ?? "").trim();
            return (
              text === "" &&
              !button.getAttribute("aria-label") &&
              !button.getAttribute("title")
            );
          })
          .map((button) => button.outerHTML.slice(0, 60));
      });
      expect(nameless, `${path} has buttons with no accessible name`).toEqual([]);
    }
  });

  test("keyboard focus reaches the sign-in controls in order", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => (document.activeElement as HTMLElement)?.getAttribute("name") ?? "",
    );
    // Tabbing lands on a real form control rather than a dead element.
    expect(["email", "password"]).toContain(focused);
  });

  test("a disabled control is genuinely disabled, not merely styled", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email");

    const send = page.getByRole("button", { name: /send qa email/i });
    await expect(send).toBeDisabled();
    // A styled-but-clickable control would still submit; this asserts the attribute.
    expect(await send.getAttribute("disabled")).not.toBeNull();
  });
});
