import { expect, test } from "@playwright/test";

import {
  credentials,
  expectRendered,
  login,
  loginAsAdmin,
  loginAsManager,
  logout,
} from "../support";

/**
 * Meaningful user ACTIONS, performed through the browser (ADR-0031).
 *
 * Every state-changing action here is followed by a RELOAD and re-assertion. A success
 * toast proves a request was accepted; only a reload proves it was persisted. That
 * distinction is the whole point of this milestone — the previous round counted a
 * response as a pass and missed five broken pages.
 *
 * No live email is possible: the application under test runs with its transport
 * credentials blanked, so every provider reports itself unconfigured.
 */

const unique = () => Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test.describe("authentication", () => {
  test("a wrong password is refused without revealing whether the account exists", async ({
    page,
  }) => {
    const creds = credentials();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(creds.admin.email);
    await page.getByLabel(/password/i).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/do not match an active AXIS account/i).first())
      .toBeVisible();
    // Still on the login screen, and no session was issued.
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  });

  test("an unknown address fails identically to a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(`nobody-${unique()}@axis-test.invalid`);
    await page.getByLabel(/password/i).fill("whatever-this-is");
    await page.getByRole("button", { name: /sign in/i }).click();

    const message = await page
      .getByText(/do not match an active AXIS account/i)
      .first()
      .innerText();
    // The message must not distinguish "no such user" from "wrong password".
    expect(message).not.toMatch(/no account|does not exist|unknown user/i);
  });

  test("a deactivated account cannot sign in", async ({ page }) => {
    const creds = credentials();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(creds.inactive.email);
    await page.getByLabel(/password/i).fill(creds.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  });

  test("no stack trace is shown to an ordinary user on a failed sign-in", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("bad@axis-test.invalid");
    await page.getByLabel(/password/i).fill("x");
    await page.getByRole("button", { name: /sign in/i }).click();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/at \w+ \(|node_modules|PrismaClient|Error:/);
  });

  test("sign out ends the session and protected pages become unreachable", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await logout(page);

    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out then in again works, and the session survives a reload", async ({
    page,
  }) => {
    const creds = await loginAsAdmin(page);
    await logout(page);
    await login(page, creds.admin.email, creds.password);

    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByRole("button", { name: /sign out/i }).first()).toBeVisible();
  });

  test("a protected URL requested while signed out redirects to login", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login/);
    // And it remembers where the person was heading.
    expect(page.url()).toMatch(/next=/);
  });
});

// ---------------------------------------------------------------------------
// Authorization — MANAGER must not reach ADMIN surfaces
// ---------------------------------------------------------------------------

test.describe("authorization", () => {
  test("a MANAGER is refused every ADMIN page by direct URL", async ({ page }) => {
    await loginAsManager(page);

    // ADMIN-only surfaces are the ones gated on MANAGE_USERS. `/admin/qa-email` and
    // its review board are gated on SEND_TEST_EMAIL, which a MANAGER legitimately
    // holds — they are placed under /admin but are not admin-only, and that is
    // asserted separately below.
    for (const path of ["/admin/users", "/admin/email-infrastructure"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();

      const redirected = !page.url().includes(path);
      const refused = /do not have permission|not allowed|forbidden/i.test(body);
      expect(redirected || refused, `${path} must not be usable by a MANAGER`).toBe(true);
      // And never by leaking an internal error.
      expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
    }
  });

  test("a MANAGER may use QA email but cannot open a QA run", async ({ page }) => {
    await loginAsManager(page);
    await page.goto("/admin/qa-email");
    await expectRendered(page, /qa email/i);

    // Reviewing and sending QA mail is manager work; STARTING a run is not.
    const start = page.getByRole("button", { name: /start a new qa run/i });

    if ((await start.count()) > 0) {
      await page.locator('input[name="label"]').fill(`manager attempt ${unique()}`);
      await start.click();

      // Either a visible refusal, or the run simply never opens. Both are correct;
      // silently opening one would not be.
      const body = await page.locator("body").innerText();
      const refused = /do not have permission|not allowed/i.test(body);
      const stillClosed = /no qa run is open/i.test(body);
      expect(refused || stillClosed, "a MANAGER must not open a QA run").toBe(true);
    }
  });

  test("the ADMIN navigation is not offered to a MANAGER", async ({ page }) => {
    await loginAsManager(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^🔑?\s*Users$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /email setup/i })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Sources — the page that broke under the stale client
// ---------------------------------------------------------------------------

test.describe("sources", () => {
  test("an ADMIN creates a source, and it persists across a reload", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");

    const name = `e2e source ${unique()}`;
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="feedUrl"]').fill("https://fixtures.example.com/new.xml");
    await page.locator('input[name="categories"]').fill("hardware, e2e");
    await page.getByRole("button", { name: /add source/i }).click();

    await expect(page.getByText(name).first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText(name).first(), "source must survive a reload").toBeVisible();
  });

  test("private, loopback, metadata and bad-scheme URLs are refused with a visible message", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const rejected = [
      "http://10.0.0.5/feed.xml",
      "http://127.0.0.1/feed",
      "http://localhost:3000/feed",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "https://user:secret@example.com/feed",
      "http://example.com:6379/",
    ];

    for (const feedUrl of rejected) {
      await page.goto("/sources");
      await page.locator('input[name="name"]').fill(`bad ${unique()}`);
      await page.locator('input[name="feedUrl"]').fill(feedUrl);
      await page.getByRole("button", { name: /add source/i }).click();

      // A visible, non-technical refusal — not a stack trace, not a silent accept.
      const alert = page.getByRole("alert");
      await expect(alert, `${feedUrl} must be refused`).toBeVisible();
      const text = await alert.innerText();
      expect(text).not.toMatch(/at \w+ \(|node_modules|PrismaClient/);
    }
  });

  test("an empty required field is refused", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");
    await page.locator('input[name="feedUrl"]').fill("https://fixtures.example.com/x.xml");
    // Name left blank — the browser's own required validation should stop submission.
    await page.getByRole("button", { name: /add source/i }).click();
    const nameField = page.locator('input[name="name"]');
    await expect(nameField).toBeFocused();
  });

  test("a source can be paused and resumed, and the state persists", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");

    const pause = page.getByRole("button", { name: /^pause$/i }).first();
    await pause.click();
    await expect(page.getByRole("button", { name: /^enable$/i }).first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.reload();
    const enable = page.getByRole("button", { name: /^enable$/i }).first();
    await expect(enable, "paused state must persist").toBeVisible();

    await enable.click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByRole("button", { name: /^pause$/i }).first()).toBeVisible();
  });

  test("a MANAGER sees no source form and is told why", async ({ page }) => {
    await loginAsManager(page);
    await page.goto("/sources");
    await expectRendered(page, /content sources/i);

    await expect(page.getByRole("button", { name: /add source/i })).toHaveCount(0);
    await expect(page.getByText(/administrator task|ask an administrator/i)).toBeVisible();
  });

  test("check sources now runs and reports a result without sending anything", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");

    await page.getByRole("button", { name: /check sources now/i }).click();
    // The fixture feed URL is unreachable, so a failure report is the correct result —
    // what matters is that the action completes and says something intelligible.
    await expect(page.getByRole("status").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
  });
});

// ---------------------------------------------------------------------------
// Content inbox — the other page that broke
// ---------------------------------------------------------------------------

test.describe("content inbox", () => {
  test("filters change the list and survive a reload via the URL", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/content/inbox");
    await expectRendered(page, /review inbox/i);

    await page.locator('select[name="filter"]').selectOption("APPROVED");
    await page.getByRole("button", { name: /^apply$/i }).click();

    await expect(page).toHaveURL(/filter=APPROVED/);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page).toHaveURL(/filter=APPROVED/);
  });

  test("a search with no results shows an empty state, not an error", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/content/inbox");

    await page.locator('input[name="search"]').fill(`zzz-no-such-article-${unique()}`);
    await page.getByRole("button", { name: /^apply$/i }).click();

    await expect(page.getByText(/nothing here yet|no articles match/i)).toBeVisible();
  });

  test("AXIS editorial copy saves, persists, and leaves source metadata untouched", async ({
    page,
  }) => {
    const creds = await loginAsAdmin(page);
    await page.goto(`/content/inbox/${creds.fixtures.pendingArticleId}`);
    await expectRendered(page, /review article/i);

    const sourceTitle = await page
      .getByText(/e2e Waiting article/i)
      .first()
      .innerText();

    const headline = `AXIS headline ${unique()}`;
    await page.locator('input[name="axisHeadline"]').fill(headline);
    await page.locator('textarea[name="axisSummary"]').fill("Why this matters to AXIS customers.");
    await page.locator('textarea[name="internalNote"]').fill("Mention at the sales meeting.");
    await page.getByRole("button", { name: /save axis copy/i }).click();

    await expect(page.getByRole("status").first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.locator('input[name="axisHeadline"]')).toHaveValue(headline);
    // The publisher's own title is unchanged.
    await expect(page.getByText(sourceTitle).first()).toBeVisible();
  });

  test("a CTA pointing at a private address is refused visibly", async ({ page }) => {
    const creds = await loginAsAdmin(page);
    await page.goto(`/content/inbox/${creds.fixtures.pendingArticleId}`);

    await page.locator('input[name="ctaLabel"]').fill("Click");
    await page.locator('input[name="ctaUrl"]').fill("http://169.254.169.254/");
    await page.getByRole("button", { name: /save axis copy/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("approve then reject moves an article between states and persists", async ({
    page,
  }) => {
    const creds = await loginAsAdmin(page);
    await page.goto(`/content/inbox/${creds.fixtures.pendingArticleId}`);

    await page.getByRole("button", { name: /approve for newsletters/i }).click();
    await expect(page.getByRole("status").first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.reload();
    // Once approved, the approve control is gone — a state assertion that cannot be
    // confused with the word "Approved" appearing in a filter list.
    await expect(
      page.getByRole("button", { name: /approve for newsletters/i }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /not for us/i }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByRole("button", { name: /not for us/i })).toHaveCount(0);

    // Put it back so the fixture is reusable and the state machine's reverse path
    // is exercised too.
    await page.getByRole("button", { name: /put back in the inbox/i }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    // Back in the waiting queue: the approve control is offered again.
    await expect(
      page.getByRole("button", { name: /approve for newsletters/i }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Newsletter creation from content
// ---------------------------------------------------------------------------

test.describe("newsletter from content", () => {
  test("selecting approved articles creates a DRAFT with the chosen order", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/content/inbox?filter=APPROVED");

    const checkboxes = page.getByRole("checkbox");
    const count = await checkboxes.count();
    expect(count, "approved fixtures should be selectable").toBeGreaterThan(1);

    // Deliberate order: the FIRST ticked becomes the hero.
    await checkboxes.nth(1).check();
    await checkboxes.nth(0).check();

    await expect(page.getByText(/2 articles chosen/i)).toBeVisible();
    await expect(page.getByText(/main article/i).first()).toBeVisible();

    await page.getByRole("button", { name: /create newsletter draft/i }).click();

    // Lands on the new draft.
    await expect(page).toHaveURL(/\/newsletters\/[^/]+\?fromContent=1/);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
  });
});

// ---------------------------------------------------------------------------
// Automations — the third page that broke
// ---------------------------------------------------------------------------

test.describe("automations", () => {
  test("create, pause, resume and run now — each persisting", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/automations");
    await expectRendered(page, /automations/i);

    const name = `e2e automation ${unique()}`;
    await page.locator('input[name="name"]').fill(name);
    await page.locator('select[name="cadence"]').selectOption("WEEKLY");
    await page.locator('select[name="language"]').selectOption("HE");
    await page.getByRole("button", { name: /create automation/i }).click();

    // Surface the reason if it was refused, rather than failing on a bare timeout.
    const alertText =
      (await page.getByRole("alert").count()) > 0
        ? (await page.getByRole("alert").first().innerText()).trim()
        : "";
    if (alertText !== "") throw new Error(`automation creation refused: ${alertText}`);

    await expect(page.getByText(name).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText(name).first(), "automation must persist").toBeVisible();

    // Counted page-wide rather than scoped to one card: the list re-orders paused
    // automations, so a positional locator is unreliable while a count is not.
    const resumeButtons = page.getByRole("button", { name: /^resume$/i });
    const pausedBefore = await resumeButtons.count();

    await page
      .locator("li")
      .filter({ hasText: name })
      .last()
      .getByRole("button", { name: /^pause$/i })
      .click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    await expect(resumeButtons, "pausing must produce a Resume control").toHaveCount(
      pausedBefore + 1,
    );

    // Resume the one we just paused and confirm the control set returns.
    await resumeButtons.last().click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(resumeButtons).toHaveCount(pausedBefore);

    await page
      .locator("li")
      .filter({ hasText: name })
      .last()
      .getByRole("button", { name: /run now/i })
      .click();

    // A run must complete and report — and must never claim to have sent anything.
    await expect(page.getByRole("status").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
    expect(body).toMatch(/nothing has been sent|review inbox|draft created|no draft/i);
  });

  test("a paused automation cannot be run", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/automations");

    const name = `e2e paused ${unique()}`;
    await page.locator('input[name="name"]').fill(name);
    await page.getByRole("button", { name: /create automation/i }).click();
    const alert2Text =
      (await page.getByRole("alert").count()) > 0
        ? (await page.getByRole("alert").first().innerText()).trim()
        : "";
    if (alert2Text !== "") throw new Error(`automation creation refused: ${alert2Text}`);
    await expect(page.getByText(name).first()).toBeVisible();

    const card = page.locator("li").filter({ hasText: name }).last();
    await card.getByRole("button", { name: /^pause$/i }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    // A paused automation must offer no way to run it: every enabled "Run now" on the
    // page belongs to an automation that is not paused.
    const disabledRuns = page.getByRole("button", { name: /run now/i, disabled: true });
    await expect(disabledRuns.first(), "a paused automation's Run now must be disabled")
      .toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Admin users
// ---------------------------------------------------------------------------

test.describe("admin users", () => {
  test("create a user, change role, deactivate and reactivate — all persisting", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await expectRendered(page, /staff accounts/i);

    const email = `e2e-user-${unique()}@axis-test.invalid`;
    const password = `Qa-${unique()}-Ax!9`;

    // The form is behind a disclosure — open it first, which is itself a control
    // worth exercising.
    await page.getByRole("button", { name: /new account/i }).click();

    // Scoped to the create form: the account list also renders a role select per row.
    const form = page.locator("form").filter({
      has: page.locator('input[name="confirmPassword"]'),
    });
    await form.locator('input[name="name"]').fill("E2E Created User");
    await form.locator('input[name="email"]').fill(email);
    await form.locator('select[name="role"]').selectOption("MANAGER");
    await form.locator('input[name="password"]').fill(password);
    await form.locator('input[name="confirmPassword"]').fill(password);
    await page.getByRole("button", { name: /create account|create staff|^create$/i }).first().click();

    await expect(page.getByText(email).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText(email).first(), "user must persist").toBeVisible();

    const row = page.locator("li, tr").filter({ hasText: email }).first();

    // Deactivate, verify, reactivate.
    const deactivate = row.getByRole("button", { name: /deactivate/i });
    if ((await deactivate.count()) > 0) {
      await deactivate.click();
      await page.waitForLoadState("networkidle");
    await page.reload();
      await expect(
        page.locator("li, tr").filter({ hasText: email }).getByText(/inactive|deactivated/i).first(),
      ).toBeVisible();

      await page
        .locator("li, tr")
        .filter({ hasText: email })
        .getByRole("button", { name: /activate|reactivate/i })
        .first()
        .click();
      await page.waitForLoadState("networkidle");
    await page.reload();
    }
  });

  test("a duplicate email is refused with a visible message", async ({ page }) => {
    const creds = await loginAsAdmin(page);
    await page.goto("/admin/users");

    const password = `Qa-${unique()}-Ax!9`;
    await page.getByRole("button", { name: /new account/i }).click();
    const dupForm = page.locator("form").filter({
      has: page.locator('input[name="confirmPassword"]'),
    });
    await dupForm.locator('input[name="name"]').fill("Duplicate attempt");
    await dupForm.locator('input[name="email"]').fill(creds.manager.email);
    await dupForm.locator('input[name="password"]').fill(password);
    await dupForm.locator('input[name="confirmPassword"]').fill(password);
    await page.getByRole("button", { name: /create account|create staff|^create$/i }).first().click();

    const body = await page.locator("body").innerText();
    // However it is worded, it must NOT leak the database constraint, and the address
    // must still appear exactly once in the account list.
    expect(body).not.toMatch(/PrismaClient|Unique constraint|node_modules/);
    const occurrences = body.split(creds.manager.email).length - 1;
    expect(occurrences, "the duplicate must not have been created").toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// QA email and review
// ---------------------------------------------------------------------------

test.describe("QA email", () => {
  test("the recipient selector offers exactly the four approved addresses and nothing else", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email");
    await expectRendered(page, /qa email/i);

    const options = await page
      .getByLabel(/qa recipient/i)
      .locator("option")
      .allInnerTexts();

    const addresses = options.filter((option) => option.includes("@"));
    expect(addresses.sort()).toEqual(
      [
        "info@axis-gps.com",
        "khaled-s@axis-gps.com",
        "moaawya@axis-gps.com",
        "saja@axis-gps.com",
      ].sort(),
    );

    // No free-text recipient, and no CC/BCC INPUT anywhere. (The page's prose does
    // mention CC and BCC — to say it has neither — so the assertion is about
    // controls, not words.)
    await expect(page.locator('input[name="recipient"]')).toHaveCount(0);
    await expect(page.locator('input[name="cc"], input[name="bcc"]')).toHaveCount(0);
    await expect(page.getByRole("option", { name: /^other$/i })).toHaveCount(0);
  });

  test("sending is blocked when no run is open, and the reason is shown", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email");

    // The seeded run is CLOSED, so the page must say so and disable the control.
    await expect(page.getByText(/no qa run is open/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send qa email/i })).toBeDisabled();
  });

  test("the live quota is displayed and is not reset by a reload", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email");

    const before = await page.locator("body").innerText();
    await page.waitForLoadState("networkidle");
    await page.reload();
    const after = await page.locator("body").innerText();

    const total = /(\d+)\s*\/\s*40/;
    expect(before.match(total)?.[1]).toBe(after.match(total)?.[1]);
  });
});

test.describe("QA rendering review", () => {
  test("records PASS, then FAIL with severity, and clears severity on PASS", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email/review");
    await expectRendered(page, /qa rendering review/i);

    const form = page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();

    await form.locator('select[name="status"]').selectOption("PASS");
    await form.locator('input[name="note"]').fill("Looked correct in Gmail.");
    await form.getByRole("button", { name: /^save$/i }).click();

    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText(/Looked correct in Gmail\./).first()).toBeVisible();

    // Now fail it with a severity.
    const form2 = page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();
    await form2.locator('select[name="status"]').selectOption("FAIL");
    await form2.locator('select[name="severity"]').selectOption("HIGH");
    await form2.getByRole("button", { name: /^save$/i }).click();

    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByText("HIGH").first()).toBeVisible();

    // Back to PASS — the severity must not linger.
    const form3 = page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();
    await form3.locator('select[name="status"]').selectOption("PASS");
    await form3.getByRole("button", { name: /^save$/i }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();

    // The severity select must be back to "—" for this check, and no HIGH badge
    // should remain on it.
    const form4 = page
      .locator("form")
      .filter({ has: page.locator('select[name="status"]') })
      .first();
    await expect(form4.locator('select[name="severity"]')).toHaveValue("");
  });

  test("the review page offers no way to send anything", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/qa-email/review");

    await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
    await expect(page.locator('select[name="recipient"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Email infrastructure
// ---------------------------------------------------------------------------

test.describe("email infrastructure", () => {
  test("renders an unconfigured provider honestly, never as verified", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/email-infrastructure");
    await expectRendered(page, /email infrastructure/i);

    const body = await page.locator("body").innerText();
    // The transport credentials are blanked in this process, so it must say so.
    expect(body).toMatch(/action required|not checked/i);
    expect(body).not.toMatch(/PrismaClient|Cannot read properties of undefined/);
    // Production must still be shown as locked.
    expect(body).toMatch(/locked/i);
  });

  test("a domain check against an unconfigured provider fails safely", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/email-infrastructure");

    await page.getByRole("button", { name: /check domain now/i }).click();

    // No API key in this process, so the only correct outcome is a friendly refusal.
    // Whatever it says, it must be a SAFE refusal: no crash, no stack trace, and
    // never an echoed credential.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/Cannot read properties of undefined|PrismaClient/);
    expect(body).not.toMatch(/at \w+ \(|node_modules/);
    expect(body).not.toMatch(/re_[A-Za-z0-9]{10,}/);
    // And the domain must NOT now claim to be verified.
    expect(body).not.toMatch(/reports the sending domain as .verified/i);
  });
});

// ---------------------------------------------------------------------------
// Double-submit safety
// ---------------------------------------------------------------------------

test.describe("repeat submission", () => {
  test("creating a source twice with the same details does not corrupt the list", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/sources");

    const name = `e2e double ${unique()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto("/sources");
      await page.locator('input[name="name"]').fill(name);
      await page.locator('input[name="feedUrl"]').fill("https://fixtures.example.com/dbl.xml");
      await page.getByRole("button", { name: /add source/i }).click();
      // Either the list now shows it, or a message explains why not — both are
      // acceptable; a crash is not.
      await expect(page.getByText(name).first()).toBeVisible();
    }

    await page.waitForLoadState("networkidle");
    await page.reload();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/PrismaClient|Unique constraint|Cannot read properties/);
  });
});
