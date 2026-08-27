# ADR-0029 — A dedicated test database, and a guard that makes the operational one unreachable

- **Status:** Accepted
- **Date:** 2026-08-24
- **Resolves:** the HIGH-severity finding recorded in [ADR-0028](0028-durable-qa-ledger-and-run-caps.md)

## Context

Automated tests ran against `axis_ccp_dev` — the operational development database. It
holds 1,215 mirrored Monday companies, 1,423 contacts, real AXIS staff accounts,
language and consent decisions, content sources, newsletter drafts, the QA send ledger
and 4,945 audit rows.

This was not theoretical. An integration suite's fixture cleanup deleted twenty rows
recording twenty real QA emails, and because the QA caps are computed by counting those
rows, it also silently restored permission to send twenty more.

ADR-0028 hardened the QA ledger specifically. It did not remove the arrangement that
made the incident possible: **any suite, at any time, could delete anything**.

## Decision

### 1. Two databases

`axis_ccp_dev` for the application. `axis_ccp_test` for automated tests, on the same
local container, on localhost, with **no additional port exposed**.

**No operational data is copied.** The test database receives schema and migrations
only. Cloning real customer emails, consent decisions or CRM records to make tests
"realistic" would spread the exposure rather than contain it.

### 2. Selection is explicit, and fails closed

`src/domain/infra/databaseTarget.ts` is a pure decision function. A test process may use
a database only when the runner is active, `TEST_DATABASE_URL` is configured, and the
name is `axis_ccp_test` or ends in `_test`. `axis_ccp_dev` is refused **by name**, with a
message saying why.

`resolveDatabaseUrl()` in `prisma.ts` branches once:

```
under the test runner  ->  TEST_DATABASE_URL, guarded, or THROW
otherwise              ->  DATABASE_URL
```

A missing `TEST_DATABASE_URL` **throws**. It never falls back, and nothing repairs a URL
into an acceptable one — a process pointed at the wrong database must stop.

### 3. The operational URL is removed from the test process

`tests/setup.env.ts` runs before any module import and **deletes `DATABASE_URL`** rather
than overwriting it. Code reaching for it — existing or written later, in the app or a
fixture — finds nothing rather than finding the operational database.

Selection happens before any Prisma client exists, so there is no hidden `process.env`
mutation after the fact.

### 4. Fixture ownership survives the move

A dedicated database is not a licence for `deleteMany({})`. Suites run in parallel
against one database, so cleanup stays scoped by owner token, and the QA
`LIVE`/`TEST_FIXTURE` protections are unchanged. Defence in depth.

Additionally, **automated tests may no longer create a `LIVE` QA record at all**: a LIVE
row asserts a real email was sent and consumes a real recipient's quota, and a test never
sends one. The meta-safety suite seeds a synthetic LIVE row through raw SQL, deliberately
and visibly, precisely because the normal path forbids it.

### 5. Providers stay unreachable

A developer machine holds real Gmail, Resend and Monday credentials, and the suite reads
the same environment. All three registries refuse a network-capable adapter under the
runner, so tests need no operational secret and a CI runner never receives one.

## Consequences

- The operational database is untouched by a full run — verified by counting every
  relevant table before and after **three consecutive runs**, with every figure identical.
- The test database proves the real migrations apply from zero: 43 tables, 36 enums, 165
  indexes and 51 foreign keys, matching `axis_ccp_dev` exactly, with no drift.
- Suites that asserted against operational data had to be rewritten to build their own
  fixtures — which is the correct dependency, and was previously hidden by the shared
  database.
- CI is now possible without operational credentials.

## Alternatives considered

**Keep one database and write more careful cleanups.** Rejected. The incident happened
because a correct-looking filter matched rows it did not own; a more careful filter is
the same control that already failed.

**Give every suite its own schema in the same database.** Rejected: it complicates
migrations and still leaves the operational tables one typo away.

**Clone `axis_ccp_dev` into `axis_ccp_test` for realism.** Rejected — it would copy real
customer email addresses and consent decisions into a database whose whole purpose is to
be wiped, multiplying the exposure this ADR exists to remove.
