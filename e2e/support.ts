import { readFileSync } from "node:fs";

import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Shared E2E harness (ADR-0031).
 *
 * Two jobs:
 *
 *  1. Sign in through the REAL browser login form. No actor injection, no forged
 *     cookie — the synthetic QA users authenticate through Auth.js exactly as staff
 *     do, so the audit trail names them truthfully.
 *  2. Fail a test on any runtime error the page produced, even when the UI carried on
 *     looking fine. That is precisely how the stale-Prisma incident escaped: services
 *     were green, routes answered, and five pages were broken.
 */

export interface Credentials {
  password: string;
  admin: { email: string; id: string };
  manager: { email: string; id: string };
  inactive: { email: string; id: string };
  fixtures: {
    sourceId: string;
    campaignId: string;
    segmentId: string;
    qaRunId: string;
    qaSendIds: string[];
    pendingArticleId: string;
    translatedArticleId: string;
    approvedArticleIds: string[];
  };
}

export function credentials(): Credentials {
  return JSON.parse(readFileSync("e2e/.auth/credentials.json", "utf8")) as Credentials;
}

/**
 * Records everything that went wrong in the page, so a test can assert on it.
 *
 * A page that renders a Next.js error overlay, throws a Prisma validation error, or
 * answers 500 is a FAILURE even if the assertion that happened to be written still
 * passed. Attach this to every page.
 */
export class PageErrors {
  readonly console: string[] = [];
  readonly pageErrors: string[] = [];
  readonly serverErrors: string[] = [];

  constructor(page: Page) {
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        const url = message.location()?.url ?? "";
        // Dev-server plumbing, not application defects: the React DevTools nag and
        // Turbopack's HMR socket, which Playwright's browser legitimately cannot keep
        // open. Everything else is recorded, including 4xx/5xx resource failures.
        if (/Download the React DevTools|Warning: Extra attributes/.test(text)) return;
        if (/_next\/hmr|__nextjs|hot-reloader|WebSocket connection/.test(text + url)) return;
        // The newsletter preview renders email HTML inside a SANDBOXED iframe with no
        // allow-scripts. Chrome reports the refusal on the console; that message is the
        // sandbox doing its job, and its absence would be the defect. Asserted
        // positively in the preview spec.
        if (/Blocked script execution in 'about:srcdoc'/.test(text)) return;
        this.console.push(url ? `${text} <- ${url}` : text);
      }
    });

    page.on("pageerror", (error) => {
      this.pageErrors.push(`${error.name}: ${error.message}`);
    });

    page.on("response", (response) => {
      if (response.status() >= 500) {
        this.serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });
  }

  get all(): string[] {
    return [
      ...this.serverErrors.map((entry) => `SERVER ${entry}`),
      ...this.pageErrors.map((entry) => `PAGE ${entry}`),
      ...this.console.map((entry) => `CONSOLE ${entry}`),
    ];
  }

  /** Fails the test if anything was recorded. */
  assertClean(context: string): void {
    expect(this.all, `${context} produced runtime errors`).toEqual([]);
  }
}

/**
 * Asserts a page rendered rather than crashed.
 *
 * Next.js shows a dev error overlay for a runtime failure; the page still returns 200,
 * so a status check alone proves nothing. This looks for the overlay and for the error
 * text those five broken pages actually showed.
 */
export async function expectRendered(page: Page, headingPattern: RegExp): Promise<void> {
  // The dev overlay renders inside a portal; its text is the giveaway.
  const body = await page.locator("body").innerText();

  expect(body, "page shows a Next.js runtime error overlay").not.toMatch(
    /Runtime (TypeError|Error)|PrismaClientValidationError|PrismaClientKnownRequestError|Unhandled Runtime Error/,
  );
  expect(body, "page shows an undefined-delegate error").not.toMatch(
    /Cannot read properties of undefined/,
  );
  expect(body, "page leaked a stack trace").not.toMatch(/at \w+ \(.*node_modules/);

  await expect(
    page.getByRole("heading", { name: headingPattern }).first(),
  ).toBeVisible();
}

/** Signs in through the real form and waits for the session to be usable. */
export async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Condition-based, and unambiguous: "Sign out" exists only for an authenticated
  // session and appears on every page of the shell.
  await expect(page.getByRole("button", { name: /sign out/i }).first()).toBeVisible({
    timeout: 20_000,
  });
}

export async function loginAsAdmin(page: Page): Promise<Credentials> {
  const creds = credentials();
  await login(page, creds.admin.email, creds.password);
  return creds;
}

export async function loginAsManager(page: Page): Promise<Credentials> {
  const creds = credentials();
  await login(page, creds.manager.email, creds.password);
  return creds;
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Attaches captured errors to the report when a test fails. */
export async function attachErrors(
  errors: PageErrors,
  testInfo: TestInfo,
): Promise<void> {
  if (errors.all.length > 0) {
    await testInfo.attach("runtime-errors", {
      body: errors.all.join("\n"),
      contentType: "text/plain",
    });
  }
}
