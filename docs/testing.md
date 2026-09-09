# Testing

## Two databases, and why

| | Database | Holds | Who may clean it |
| --- | --- | --- | --- |
| **Development application** | `axis_ccp_dev` | Mirrored Monday CRM, real AXIS staff accounts, language and consent decisions, content sources, newsletter drafts, the QA send ledger, audit history | **Nobody automatic.** Never a test. |
| **Automated tests** | `axis_ccp_test` | Synthetic fixtures only | The suite that owns them |

This separation exists because of an incident. Automated tests used to run against
`axis_ccp_dev`, and an integration suite's fixture cleanup deleted twenty rows recording
twenty real QA emails. Because the QA send caps are computed by counting those rows,
deleting them also silently restored permission to send twenty more.

The fix is not a more careful cleanup. It is that **a test process cannot name the
operational database at all**.

**No operational data is copied into the test database.** It gets schema and migrations,
nothing else. Real customer emails, consent decisions, CRM records and QA history are
never cloned to make tests realistic.

---

## How a test selects its database

`tests/setup.env.ts` runs before any test module is imported, and therefore before any
Prisma client can exist. It:

1. loads `.env.local`;
2. **deletes the operational `DATABASE_URL` from the process** before any client loads;
3. validates `TEST_DATABASE_URL` and fails the whole run if it is missing or unsafe;
4. assigns only that validated test URL to `DATABASE_URL` for third-party tooling and
   prints a credential-free banner naming the target.

`src/server/db/prisma.ts` then resolves the connection explicitly:

```
under the test runner  →  TEST_DATABASE_URL, guarded, or THROW
otherwise              →  DATABASE_URL
```

**It fails closed.** A missing `TEST_DATABASE_URL` never falls back to `DATABASE_URL`.

Developers do not swap environment variables before running tests. `npm test` targets
the test database automatically.

Vitest caps worker processes at four. Each process owns a bounded PostgreSQL pool;
an unbounded worker count can exhaust a small database before tests even begin.
The three QA integration suites hold a shared advisory lock in the guarded test
database through fixture cleanup. QA quotas are deliberately lifetime-wide: synthetic
LIVE evidence created by a cap test must not make another suite's allowlist send fail.
Each waiting QA suite uses one temporary connection; other suites and within-suite
concurrency checks remain parallel. Production quota accounting is unchanged.
Explicit concurrency tests still exercise racing job claims, duplicate events and
delivery attempts. Run `npm run typecheck:workflows` alongside the application typecheck
to check the new workflow integration suite, which the application build excludes.

`npm run ops:benchmark` creates its own disposable Docker database, two app replicas
and a scheduler. It exercises only synthetic data and disabled external adapters.
See [capacity measurements](capacity.md) and [workflow operations](workflow-operations.md).

---

## The safety guard

`src/domain/infra/databaseTarget.ts` is a pure function deciding whether a connection
string is acceptable for a test process. It requires **multiple** signals to agree:

- the process is under the test runner (`NODE_ENV=test` or `VITEST`), **and**
- `TEST_DATABASE_URL` is explicitly configured, **and**
- the database name is `axis_ccp_test` or ends in `_test`.

Refused, always:

| Target | Result |
| --- | --- |
| `axis_ccp_test` | accepted |
| `axis_ci_1234_test` | accepted (so CI can supply its own) |
| `axis_ccp_dev` | **refused by name** — "the AXIS operational development database" |
| `axis_ccp_prod`, `postgres`, `template1` | refused |
| `testing`, `test` | refused — they do not end in `_test` |
| missing, malformed, no database name, non-Postgres | refused |

A refusal stops the process. Nothing repairs a URL into an acceptable one.

---

## Recreating the test database

It already exists on the local Postgres container. To recreate it from scratch:

```bash
docker exec axis-ccp-postgres-dev psql -U axis -d postgres -c "CREATE DATABASE axis_ccp_test OWNER axis;"
npm run test:db:migrate
```

The database is on the existing container and stays on localhost. **No additional
PostgreSQL port is exposed.**

### Migrations

The test database receives the **same committed migrations** as production, applied with
`prisma migrate deploy`. There is no test-only schema and `db push` is never used as a
substitute — running the real migrations from an empty database is part of what the test
database proves.

```bash
npm run test:db:migrate   # prisma migrate deploy against axis_ccp_test
npm run test:db:reset     # drop, recreate, re-apply every migration
```

`test:db:reset` asserts its target first. Given `axis_ccp_dev` it prints `REFUSED` and
exits non-zero. There is no flag that disables the check, and no "reset any URL" mode.

---

## Fixture ownership

Even inside the test database, cleanup stays **scoped**. A dedicated database is not a
licence for `deleteMany({})`.

Each suite owns a token and deletes only what carries it:

```ts
const OWNER = `my-suite-${randomUUID().slice(0, 12)}`;
// …
await ledger.deleteFixtures(OWNER);   // pins origin: TEST_FIXTURE AND this owner
```

This matters because suites run in **parallel workers against one database**. Without
ownership, one suite's cleanup removes another's rows mid-assertion.

### QA ledger protections remain (defence in depth)

The `LIVE` / `TEST_FIXTURE` distinction introduced for the QA ledger is unchanged:

- a `LIVE` row may not carry a `fixtureOwner`, so it cannot match a scoped delete;
- `deleteFixtures` refuses an empty owner rather than matching everything;
- **automated tests cannot create a `LIVE` record at all** — the repository refuses it,
  because a LIVE row asserts a real email was sent and consumes a real recipient's quota;
- a `TEST_FIXTURE` record has no promotion path to `LIVE`.

---

## External services are unavailable in tests

Regardless of what `.env.local` contains:

| Adapter | Under tests |
| --- | --- |
| Gmail SAFE TEST | unavailable — resolves to a transport that throws |
| QA Gmail | unavailable — resolves to `FAKE_QA`, which throws |
| Resend production | unavailable — resolves to `DISABLED`, which throws |
| Monday CRM | query-only port; suites use a fake source |

A developer machine holds real credentials and the suite reads the same environment, so
this is enforced in the registries rather than left to discipline.

Tests therefore need **no** `MONDAY_API_TOKEN`, Gmail App Password, `RESEND_API_KEY` or
Cloudinary secret.

---

## Running tests

```bash
npm test              # full suite against axis_ccp_test
npx vitest run path/to/suite.int.test.ts
```

Every run prints:

```
AXIS test environment
  Test database: axis_ccp_test
  Host:          localhost:5432
  Environment:   TEST
  Live email:    DISABLED (Gmail, QA and Resend adapters are unavailable)
```

If that banner ever names anything but a test database, stop and investigate.

---

## CI configuration (when it exists)

A CI runner needs only:

```
TEST_DATABASE_URL=postgresql://…/axis_ci_<id>_test
```

Then `npm run test:db:migrate && npm test`. Any name ending in `_test` is accepted, so
parallel CI jobs can each have their own database.

**CI must never be given operational credentials** — not `DATABASE_URL`, not a Monday
token, not a provider key. Nothing in the suite needs them.

---

## After ANY Prisma schema or migration change

**Stop Next.js, regenerate, then start it again.**

```bash
# 1. stop the dev server
# 2. npx prisma migrate deploy   (or migrate dev)
# 3. npx prisma generate
# 4. npm run dev                (also regenerates Prisma through predev)
```

Turbopack does **not** pick up a regenerated Prisma Client through HMR. A long-running
`next dev` keeps the client it started with, and every page using a model added since
then fails at runtime with either:

- `Cannot read properties of undefined (reading 'findUnique')` — the model is absent
  from the client entirely, or
- `PrismaClientValidationError: Invalid ... findMany()` — the client rejects fields it
  was never generated with.

This has happened once, taking out five authenticated pages while the whole service and
integration suite stayed green. If the cache seems stale, remove `.next` as well.

`e2e/preflight.mjs` runs before every browser E2E run and aborts if the generated client
is missing a delegate any page needs, including scheduler and delivery infrastructure.
`npm run dev` regenerates the client before starting Next.js. This does not update a
process that is already running and never applies migrations automatically. Stop and
restart the existing server after schema changes; back up operational data before an
explicit release migration. Never reset the operational database to repair this error.

Customer readiness does not query scheduler storage when the scheduler is disabled.
If an enabled scheduler has an outdated client or missing schema, it reports a blocked
setup message. Unavailable scheduler storage must never permit customer sending.

The shared `getPrisma()` cache is versioned by the generated datamodel, migration manifest,
database target and pool settings. It validates every model delegate before reusing a
client, replaces incompatible cached clients and drains their pools. It also checks that
the imported generated module contains the workflow models/fields; creating another
instance of obsolete generated code is not recovery. Database readiness now validates
this running client before returning success. No report substitutes zero for unreadable
delivery data. Regression coverage includes actual Reports queries after stale-cache
replacement, Operations queries with a cached client missing `jobSchedule`, and refusal
to bypass test-database isolation through a warm cache. The delegate regressions also
cover `mondayWebhookEvent` alongside the scheduler, jobs and provider receipts.

Finish Prisma generation before starting a test process that imports its generated
files. Running tests concurrently with the `predev` generation step can observe files
while they are being replaced; that is an invalid test run, not a service regression.

## Browser E2E (Playwright)

```bash
npm run e2e            # preflight + re-seed + run every spec
npm run e2e:report     # open the HTML report
```

The run builds the application and serves it on **port 3100** with `DATABASE_URL`
pointed at `axis_ccp_test`, so it never touches operational data and leaves the
developer's own server on :3000 alone. (Next.js refuses two dev servers in one
directory, so stop :3000 first if you are running `next dev` there.)

**No live email is possible from the E2E server**: its Gmail, Resend and Monday
credentials are blanked in `playwright.config.ts`, so every transport reports itself
unconfigured and a send button exercises the refusal path.

Fixtures are re-seeded by `globalSetup` before every run, because the specs deliberately
mutate them. A suite whose result depends on how many times it has been run cannot
report a regression.

## Mixed-format articles (ADR-0036)

`articleFormat.test.ts` and `feedParser.test.ts` cover plain/Markdown/HTML mixtures,
encoded fragments, RSS/Atom/CDATA, relative images, multilingual text and safe conversion.
`feedFetcher.test.ts` mocks DNS and HTTP to check explicit picture downloads without any
network call. Content workflow/automation integration tests use owned synthetic fixtures
to verify saved markup, image retention, editorial precedence, frozen documents and zero
delivery writes. Oversized or overly nested authoring input is refused before persistence.

`e2e/specs/08-article-formats.spec.ts` exercises formatted clipboard paste plus HTML-file
import in the same article, save/reload, approval, newsletter composition and computer/phone
preview using a synthetic picture intercepted by Playwright. No publisher is contacted.

## Manual QA rendering review

`/admin/qa-email/review` records what a human saw in the inbox for QA messages that were
already sent. It sends nothing, resends nothing and consumes no quota — it has no
recipient selector and no send control.

Each message shows the checklist written when its scenario was designed. Record
**Pass**, **Fail** (with a severity) or leave it **Not checked**. Anything not checked
stays not checked; it is never counted as a pass.

A failed check does not trigger a retest. A retest is a live email to a colleague and
consumes quota, so it needs explicit authorisation each time.

## Troubleshooting

**"AUTOMATED TESTS CANNOT START"** — `TEST_DATABASE_URL` is missing or names an
unacceptable database. Check `.env.local`. This is the guard working; do not point it at
`axis_ccp_dev`.

**"Automated tests are not allowed to use the AXIS operational development database"** —
something tried to resolve to `axis_ccp_dev`. Find the caller; do not adjust the guard.

**"Automated tests may not create LIVE QA records"** — a test tried to write a `LIVE` QA
row. Use `origin: "TEST_FIXTURE"` with a fixture owner.

**Relation does not exist** — the test database is behind. Run `npm run test:db:migrate`.

**Flaky counts across suites** — a global `count()` racing with a parallel worker. Scope
the assertion to the fixture under test rather than the whole table.

## Hebrew translation checks (ADR-0037)

`src/domain/content/hebrewTranslation.test.ts` checks protected identifiers, figures,
links and structure, mixed input, complete Hebrew output and invalid-result refusal.
The adapter contract tests strict structured requests and reject live construction in tests.
`tests/integration/articleTranslation.int.test.ts` uses a synthetic provider and the
guarded test database to check separate draft creation, review gates, provenance, caching,
concurrency, source changes, request limits and failure atomicity. It makes no OpenAI call.
`e2e/specs/09-hebrew-translation.spec.ts` checks configuration refusal, source comparison,
mobile layout, Hebrew editing, approval and canonical email preview with synthetic fixtures.
These checks establish workflow behavior, not the linguistic quality of real translations.

The ADR-0038 copy/paste path additionally checks bounded reply parsing, signed receipt
expiry and actor/source binding, original preservation, concurrent import reuse, stale
source refusal and zero provider calls. `e2e/specs/10-chatgpt-translation.spec.ts` tests
clipboard copying, malformed reply feedback, responsive layout and persisted Hebrew
draft creation with an invented reply. ChatGPT itself is not automated or contacted.
Source coverage tests distinguish an excerpt from a saved body and image-only input.
ADR-0039 BiDi checks cover NavVis CLX, NavVis VLX, RTK, SLAM and BIM inside Hebrew,
punctuation outside isolation, URLs, accented Latin, every supported text block and
captions. Browser checks measure actual character order and computed directions, check
local overflow/list markers, save/reload exact plain values and capture RTL desktop/phone
proof. The email renderer's existing tests remain unchanged.
The browser flow starts with a truncated excerpt, follows the full-text editor link,
saves additional paragraphs and proves that a fresh prompt and imported draft include
the final paragraph. Saving clears the old prompt; the server refuses stale responses.
