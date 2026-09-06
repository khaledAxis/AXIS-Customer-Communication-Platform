# Reports runtime repair — 2026-09-06

## Result

The Reports failure (`providerWebhookReceipt.count` on an undefined delegate) and
the earlier missing scheduler delegate share an obsolete Prisma runtime problem.
The previous singleton blindly retained its client across development reloads. A
current generated client on disk did not make that cached instance current.

The shared database entry point now fingerprints the generated model/field metadata,
migration manifest, validated connection target and pool configuration. It reuses only
a compatible client, replaces incomplete or old cached instances and drains retired
pools. An obsolete generated module fails with explicit regeneration/restart guidance.
The health check verifies this runtime contract before reporting database readiness.
Reports continue to query real counts; there is no fallback that disguises failures
as zero activity. No schema migration or operational data edit was needed for this repair.

## Exact files changed for this repair

| File | Change |
| --- | --- |
| `src/server/db/prisma.ts` | Validate generated models and all delegates; version and retire cached clients; validate test target before reuse. |
| `src/server/db/prisma.test.ts` | Ten regression cases for module reloads, stale clients, stale generated metadata and database isolation. |
| `src/server/services/healthService.ts` | Require a compatible running client even when SQL readiness is cached. |
| `src/server/services/healthService.test.ts` | Three health regression cases. |
| `tests/integration/prismaCacheRecovery.int.test.ts` | Reproduce an incomplete cached client and execute Reports against synthetic PostgreSQL after recovery. |
| `tsconfig.workflows.json` | Include the new database integration regression in workflow typechecking. |
| `tests/integration/crmSync.int.test.ts` | Scope anti-mass-archival row counts to the suite's twenty owned companies. |
| `tests/integration/qaEmail.int.test.ts` | Isolate shared quota fixtures; include refusal reason in assertion diagnostics. |
| `tests/integration/qaLedgerIntegrity.int.test.ts` | Isolate shared quota fixtures. |
| `tests/integration/qaReview.int.test.ts` | Isolate shared quota fixtures. |
| `tests/support/qaQuotaLock.ts` | Guarded test-database advisory lock for the three QA suites, held through cleanup. |
| `AGENTS.md` | Document Prisma cache and health invariants. |
| `docs/testing.md` | Document stale-client recovery, regression checks and shared QA fixture isolation. |
| `docs/decisions/0035-durable-workflows-customer-dispatch-and-reporting.md` | Record the singleton coherence correction. |
| `docs/prisma-cache-runtime-fix.md` | This repair record. |

Other pre-existing workspace changes were preserved. The existing `predev` client
generation step from the previous readiness repair remains in place.

## Validation and commands

| Check | Result |
| --- | --- |
| Production build, invoked by the Playwright setup | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:workflows` | PASS |
| `npm run lint` | PASS |
| `npm run test -- --reporter=dot` | PASS — 1,457 tests across 84 files. |
| Targeted Prisma/client-health recovery tests | PASS — 14 tests. |
| Authenticated render, health and workflow Chromium checks | PASS — 11 tests, including Reports, Readiness, Operations and CSV export. |
| Restarted development server `/api/health/ready` | PASS — HTTP 200, `{"status":"ok"}`. |
| `git diff --check` | PASS — only existing line-ending normalization notices. |

Browser command:

```powershell
npm run e2e -- e2e/specs/01-authenticated-render.spec.ts e2e/specs/06-health.spec.ts e2e/specs/07-workflows.spec.ts --project=chromium
```

The initial full runs exposed two fixture races: global CRM counts included other
suites' rows, and QA cap fixtures could temporarily exhaust another suite's quota.
These were corrected without changing CRM behavior or the application's sending
limits. The final full suite passed after both corrections. All fixture writes and
browser logins used the guarded synthetic test database; live adapters stayed disabled.

## Local runtime and limits

The previous repository-owned development processes were stopped. Automatic approval
review rejected the combined deletion/restart command; no action ran from that command.
A safe alternative preserved the old cache by renaming it to
`.next/dev-before-prisma-cache-fix-20260906`, then restarted through `npm run dev`
bound to `127.0.0.1:3000`. Client generation ran during startup. Runtime logs are in
`var/prisma-cache-dev.log` and `var/prisma-cache-dev-error.log`.

No customer email, Monday synchronization, provider request, deployment, database
reset or operational data mutation was performed. Customer delivery remains locked.
The production build and authenticated browser checks used synthetic data; the
operational development server was verified through its runtime-and-migration health
endpoint, without creating a staff account or impersonating an existing user.

Future schema changes still require explicit migrations and client generation.
This repair does not replace external hosting, worker, subscription or release setup.

## Operations follow-up: missing `jobSchedule.findUnique`

The later Operations error could not be reproduced on the current application code.
At investigation time, the sole Next.js listener was the repaired repository server
on `127.0.0.1:3000`. Its log contained health probes and no Operations request since
the previous restart. No other AXIS web server or hosted application container was
found. This supports an older-page/runtime explanation, but the original error window
was not accessible to the agent and its address was requested from the user.

Two unit cases now explicitly cover missing `jobSchedule` and `mondayWebhookEvent`
delegates. A PostgreSQL integration case hides only `jobSchedule` on an otherwise real
client, then proves `getJobOperations()` replaces it and completes its actual queries.
No additional application-service change or database migration was made.

The previous browser run exercised a production build. This follow-up additionally
ran the same eleven authenticated rendering, health and workflow checks under
**Next.js 16.3.1 / Turbopack development mode**: all passed, including Operations for
both staff roles, navigation and refresh. The development application was temporarily
stopped to avoid two processes sharing `.next/dev`, then restarted on port 3000 after
the isolated test server stopped. Its readiness endpoint returned HTTP 200.

Follow-up repository changes are exactly:

- `src/server/db/prisma.test.ts`
- `tests/integration/prismaCacheRecovery.int.test.ts`
- `docs/testing.md`
- `docs/prisma-cache-runtime-fix.md`

The disposable development-mode Playwright configuration is retained at
`var/operations-dev.playwright.config.ts` (ignored). It inherits the normal guarded
test database, synthetic login, disabled providers and no-server-reuse configuration.

Follow-up validation: **Typecheck PASS; workflow typecheck PASS; Lint PASS; Tests
PASS (17 targeted tests and 11 development browser checks); Build NOT RUN** because
no application code changed. One targeted run was accidentally started during
`predev` generation and observed missing/incomplete generated files. After generation
completed, the same checks passed. The existing full production-build validation above
is from the preceding repair, not a new build in this follow-up.

Commands included `npm run typecheck`, `npm run typecheck:workflows`, `npm run lint`,
targeted `npm run test`, and:

```powershell
npm run e2e -- --config var/operations-dev.playwright.config.ts e2e/specs/01-authenticated-render.spec.ts e2e/specs/06-health.spec.ts e2e/specs/07-workflows.spec.ts --project=chromium
```

Diagnostics: `var/operations-runtime-tests.log`, `var/operations-dev-e2e.log`,
`var/operations-runtime-dev.log` and `var/operations-runtime-dev-error.log`.
No operational data was changed. No live adapter was invoked.
