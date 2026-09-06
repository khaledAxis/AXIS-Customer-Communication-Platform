# Readiness runtime repair — 2026-09-06

## Executive summary

The development server retained a Prisma client created before `SchedulerHeartbeat`
existed. The generated client on disk was current, but the operational database also
lacked the two September 5 migrations. These are separate failures: restarting alone
would replace the undefined delegate with a missing-table error.

## Repository changes

- `package.json`: `predev` generates Prisma before Next.js starts; it never migrates.
- `e2e/preflight.mjs`: checks all six new infrastructure delegates before browser tests.
- `src/server/services/productionDispatchService.ts`: a disabled scheduler performs no
  heartbeat query. An enabled scheduler with an outdated client, missing schema or
  unavailable storage reports a blocked release with an actionable, sanitized message.
- `src/server/services/customerReleaseStatus.test.ts`: eight regression cases covering
  stale clients, missing tables/columns, database failures, stale/absent/current
  heartbeats, and a disabled scheduler.
- `tests/integration/audienceConcurrency.int.test.ts`: observes the real watermark
  inside readiness instead of querying it later, when another suite may have changed
  its own fixtures. The watermark behavior and assertions remain enforced.
- `AGENTS.md`, `docs/testing.md`, this report: record startup and repair behavior.

## Architecture decisions

This is a correction within [ADR-0035](decisions/0035-durable-workflows-customer-dispatch-and-reporting.md),
with no new dependency, delivery permission, automatic migration or architectural change.

## Commands and recovery actions

Stopped only this project's existing Next.js development processes. Created an AES-GCM
encrypted `pg_dump` outside the checkout, authenticated the entire archive, and verified
its structure using `pg_restore --list`. The Windows/Docker bind mount could not expose
the recovery directory, so backup and archive inspection used streams instead.

Explicitly applied only the two previously reviewed additive migrations using Prisma:

- `20260905150000_shared_hosted_login_throttle`
- `20260905210000_durable_workflows`

Read-only integrity checks across all 43 pre-existing tables confirmed identical row
counts and data fingerprints before/after. No reset, fixture creation or data cleanup
ran on the operational database. The app restarted through `npm run dev`, which first
regenerated Prisma. Customer delivery and scheduling remain disabled.

Validation commands: `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run e2e -- e2e/specs/07-workflows.spec.ts --project=chromium`. The browser command
builds the production/standalone application and uses only `axis_ccp_test`.

## Validation results

| Check | Result |
|---|---|
| Build | PASS — production/standalone build in the browser workflow |
| Typecheck | PASS |
| Lint | PASS — no warnings |
| Tests | PASS — 1,443 tests, 81 files, including eight new regression cases |
| Browser | PASS — three workflow checks, including the locked readiness page |
| Local runtime | PASS — login and database readiness return HTTP 200 |
| Existing data | PASS — all 43 existing table fingerprints and counts preserved |
| Diff whitespace | PASS |

Logs are in `var/readiness-fix-*.log`. The protected recovery archive location is
recorded locally in `var/readiness-backup-result.json`; its key and archive stay outside
the checkout. No real CRM data entered automated tests.

## Assumptions and open questions

The failing runtime was the existing loopback development server on port 3000. The
repair did not activate hosted customer delivery or any live CRM/email workflow.

## Risks and technical debt

Prisma generation does not update an already-running Node process. Future schema changes
still require an explicit migration and server restart. The new startup step and
readiness diagnostics make the failure easier to prevent and identify.

## Current project state

The local database now has all 18 migrations and the restarted app uses the current
client. Login/database health were checked locally; authenticated readiness rendering
was verified against synthetic fixtures in the production browser test environment.

## Recommended next task

Reload the affected readiness tab in the existing signed-in browser session.
