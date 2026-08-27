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
    await expect(page.getByRole("link", { name: /newsletters/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i }).first()).toBeVisible();
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
