# ADR-0031 — Authenticated browser E2E with Playwright

- **Status:** Accepted
- **Date:** 2026-08-24
- **Builds on:** [ADR-0029](0029-dedicated-test-database.md)

## Context

Five authenticated pages were completely broken at runtime — a stale Prisma Client in a
long-running dev server — while the entire unit, integration, security and isolation
suite stayed green. Those pages had been recorded as "browser smoke PASS" because an
anonymous request returned `307 → /login`.

A redirect proves the proxy works. It proves nothing about the page.

## Decision

**Every page is opened with a real session and asserted to have RENDERED**: no Next.js
error overlay, no `Cannot read properties of undefined`, no Prisma validation error, no
leaked stack trace, no 500, no page error, and a real heading. Console, page errors and
5xx responses are captured per page and fail the test even when the UI carried on.

Supporting decisions:

- **Playwright**, running against a **production build** on port 3100, not `next dev`.
  A dev server compiles on demand, so the browser observes transient 403s on assets
  being written — noise indistinguishable from a real authorization defect.
- **`DATABASE_URL` points at `axis_ccp_test`**, so destructive UI actions touch
  synthetic fixtures only.
- **Transport credentials are BLANKED** in `playwright.config.ts` (Gmail, Resend,
  Monday). The E2E server runs outside the test runner, so the "no live adapter under
  vitest" guard does not apply; removing the secrets is a stronger guarantee than a
  flag somebody could flip.
- **Real login through the form.** No actor injection, no forged cookie — synthetic QA
  users authenticate through Auth.js, so the audit trail names them truthfully.
- **`e2e/preflight.mjs` aborts the run** if the generated client is missing a delegate
  any page needs, so the stale-client failure cannot reach a browser silently.
- **Fixtures are re-seeded by `globalSetup`** before every run, because the specs
  deliberately mutate them. A suite whose result depends on how many times it has run
  cannot report a regression.
- **State is asserted after a reload**, never from a success message alone.

## Consequences

- The class of defect that prompted this is now caught before a human sees it.
- Two harness lessons, both now encoded: locate elements by stable `name` attributes
  rather than list position, and wait for a server action's navigation to settle before
  reloading.
- Coverage is not yet complete — customers, communication, segments, the newsletter
  editor and the four-eyes flow remain integration-only.

## Alternatives considered

**Keep counting anonymous 307s.** Rejected: that is what missed the outage.

**Run against `next dev`.** Rejected — on-demand compilation produces failures that
look like defects.
