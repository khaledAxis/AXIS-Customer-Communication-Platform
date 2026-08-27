import { expect, test } from "@playwright/test";

import {
  PageErrors,
  attachErrors,
  expectRendered,
  loginAsAdmin,
  loginAsManager,
} from "../support";

/**
 * Every implemented page, opened AUTHENTICATED (ADR-0031).
 *
 * This is the spec that would have caught the stale-Prisma incident. Those five pages
 * answered 307 to anonymous traffic — which earlier reports counted as a browser PASS
 * — while being completely broken for anybody actually signed in.
 *
 * So each page here is opened with a real session, and asserted to have RENDERED:
 * no Next.js error overlay, no `Cannot read properties of undefined`, no Prisma
 * validation error, no leaked stack trace, no 500, no page error, and a real heading.
 */

const ADMIN_PAGES: { path: string; heading: RegExp; name: string }[] = [
  { path: "/", heading: /welcome to axis/i, name: "Dashboard" },
  { path: "/customers", heading: /customers/i, name: "Customers" },
  { path: "/communication", heading: /communication/i, name: "Communication" },
  { path: "/segments", heading: /audiences|segments/i, name: "Segments" },
  { path: "/segments/new", heading: /audience|segment/i, name: "New segment" },
  { path: "/content", heading: /content|articles/i, name: "Content" },
  { path: "/content/new", heading: /article|content/i, name: "New article" },
  { path: "/content/inbox", heading: /review inbox/i, name: "Review inbox" },
  { path: "/sources", heading: /content sources/i, name: "Sources" },
  { path: "/newsletters", heading: /newsletters/i, name: "Newsletters" },
  { path: "/newsletters/new", heading: /newsletter/i, name: "New newsletter" },
  { path: "/automations", heading: /automations/i, name: "Automations" },
  { path: "/reports", heading: /reports/i, name: "Reports" },
  { path: "/admin/users", heading: /staff accounts/i, name: "Admin users" },
  {
    path: "/admin/email-infrastructure",
    heading: /email infrastructure/i,
    name: "Email infrastructure",
  },
  { path: "/admin/qa-email", heading: /qa email/i, name: "QA email" },
  {
    path: "/admin/qa-email/review",
    heading: /qa rendering review/i,
    name: "QA rendering review",
  },
];

test.describe("authenticated render — every page", () => {
  test("ADMIN can open every page without a runtime error", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);
    await loginAsAdmin(page);

    const failures: string[] = [];

    for (const target of ADMIN_PAGES) {
      const before = errors.all.length;
      await page.goto(target.path, { waitUntil: "domcontentloaded" });

      try {
        await expectRendered(page, target.heading);
      } catch (error) {
        failures.push(
          `${target.name} (${target.path}): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        );
      }

      const produced = errors.all.slice(before);
      if (produced.length > 0) {
        failures.push(`${target.name} (${target.path}) errors: ${produced.join(" | ")}`);
      }
    }

    await attachErrors(errors, testInfo);
    expect(failures, "pages that failed to render for an authenticated ADMIN").toEqual(
      [],
    );
  });

  test("dynamic detail pages render for a real record", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);
    const creds = await loginAsAdmin(page);
    const failures: string[] = [];

    const dynamic: { path: string; heading: RegExp; name: string }[] = [
      {
        path: `/newsletters/${creds.fixtures.campaignId}`,
        heading: /newsletter|draft/i,
        name: "Newsletter editor",
      },
      {
        path: `/newsletters/${creds.fixtures.campaignId}/preview`,
        heading: /preview/i,
        name: "Newsletter preview",
      },
      {
        path: `/newsletters/${creds.fixtures.campaignId}/readiness`,
        heading: /readiness|send/i,
        name: "Send readiness",
      },
      {
        path: `/content/inbox/${creds.fixtures.pendingArticleId}`,
        heading: /review article/i,
        name: "Article review",
      },
      {
        path: `/content/${creds.fixtures.approvedArticleIds[0]}/edit`,
        heading: /article|edit/i,
        name: "Article edit",
      },
      {
        path: `/segments/${creds.fixtures.segmentId}`,
        heading: /audience|segment/i,
        name: "Segment detail",
      },
    ];

    for (const target of dynamic) {
      const before = errors.all.length;
      await page.goto(target.path, { waitUntil: "domcontentloaded" });
      try {
        await expectRendered(page, target.heading);
      } catch (error) {
        failures.push(
          `${target.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        );
      }
      const produced = errors.all.slice(before);
      if (produced.length > 0) failures.push(`${target.name} errors: ${produced.join(" | ")}`);
    }

    await attachErrors(errors, testInfo);
    expect(failures, "dynamic pages that failed to render").toEqual([]);
  });

  test("MANAGER can open every page they are entitled to", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);
    await loginAsManager(page);
    const failures: string[] = [];

    const managerPages = ADMIN_PAGES.filter(
      (target) => !target.path.startsWith("/admin/"),
    );

    for (const target of managerPages) {
      const before = errors.all.length;
      await page.goto(target.path, { waitUntil: "domcontentloaded" });
      try {
        await expectRendered(page, target.heading);
      } catch (error) {
        failures.push(
          `${target.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        );
      }
      const produced = errors.all.slice(before);
      if (produced.length > 0) failures.push(`${target.name} errors: ${produced.join(" | ")}`);
    }

    await attachErrors(errors, testInfo);
    expect(failures, "pages that failed to render for an authenticated MANAGER").toEqual(
      [],
    );
  });
});

test.describe("newsletter preview sandbox", () => {
  test("email HTML is rendered inside a sandboxed iframe with scripts disabled", async ({
    page,
  }) => {
    const creds = await loginAsAdmin(page);
    await page.goto(`/newsletters/${creds.fixtures.campaignId}/preview`);

    const frame = page.locator("iframe").first();
    await expect(frame).toBeVisible();

    // The preview shows untrusted-shaped HTML. `allow-scripts` must NOT be present:
    // its absence is what makes rendering arbitrary email markup safe.
    const sandbox = await frame.getAttribute("sandbox");
    expect(sandbox, "preview iframe must carry a sandbox attribute").not.toBeNull();
    expect(sandbox ?? "").not.toContain("allow-scripts");
  });
});

test.describe("dynamic id handling — IDOR and malformed input", () => {
  test("a nonexistent or malformed id gives a safe page, never a stack trace", async ({
    page,
  }, testInfo) => {
    const errors = new PageErrors(page);
    await loginAsAdmin(page);
    const failures: string[] = [];

    const probes = [
      "/newsletters/does-not-exist",
      "/newsletters/%20%20",
      "/content/inbox/does-not-exist",
      "/segments/does-not-exist",
      "/customers/does-not-exist",
      "/content/does-not-exist/edit",
    ];

    for (const path of probes) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();

      // A safe 404 or a friendly message is fine. A stack trace or a raw Prisma error
      // is not — it tells an attacker about the schema and the file layout.
      if (/at \w+ \(.*node_modules|PrismaClient\w*Error|Cannot read properties of undefined/.test(body)) {
        failures.push(`${path} leaked an internal error`);
      }
    }

    await attachErrors(errors, testInfo);
    expect(failures, "dynamic ids that leaked internals").toEqual([]);
  });
});

test.describe("navigation", () => {
  test("every navigation link opens a page that renders", async ({ page }, testInfo) => {
    const errors = new PageErrors(page);
    await loginAsAdmin(page);
    await page.goto("/");

    const navLinks = await page
      .locator("nav a, header a")
      .evaluateAll((anchors) =>
        anchors
          .map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href"))
          .filter((href): href is string => !!href && href.startsWith("/")),
      );

    const unique = [...new Set(navLinks)];
    expect(unique.length, "navigation should expose links").toBeGreaterThan(5);

    const failures: string[] = [];
    for (const href of unique) {
      const before = errors.all.length;
      await page.goto(href, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      if (/Runtime (TypeError|Error)|PrismaClient\w*Error|Cannot read properties of undefined/.test(body)) {
        failures.push(`${href} crashed`);
      }
      const produced = errors.all.slice(before);
      if (produced.length > 0) failures.push(`${href}: ${produced.join(" | ")}`);
    }

    await attachErrors(errors, testInfo);
    expect(failures, "navigation links that led to a broken page").toEqual([]);
  });

  test("back, forward and refresh keep the page working", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/sources");
    await expectRendered(page, /content sources/i);

    await page.goto("/content/inbox");
    await expectRendered(page, /review inbox/i);

    await page.goBack();
    await expectRendered(page, /content sources/i);

    await page.goForward();
    await expectRendered(page, /review inbox/i);

    await page.reload();
    await expectRendered(page, /review inbox/i);
  });
});
