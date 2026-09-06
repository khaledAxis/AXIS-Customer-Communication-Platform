# ADR-0035: Durable workflows, customer dispatch and reporting

- Status: Accepted
- Date: 2026-09-05
- Decision authority: Repository owner explicitly requested completion of scheduled jobs,
  Monday webhooks, production dispatch, reporting and capacity benchmarking.
- Amends: ADR-0005 (jobs), ADR-0021 (actual-delivery consent), ADR-0022/0024/0025
  (production preparation and events), ADR-0026 (scheduled assisted execution),
  ADR-0034 (optional operator release configuration).

## Decision

Use PostgreSQL for durable jobs and a small Node worker that invokes one authenticated
job tick at a time. No Redis, BullMQ, third-party scheduler, or new component library.
The existing relational database can atomically deduplicate, claim, lease and recover
the internal workload. Add `jose@6.2.9` as a direct dependency to verify Monday HS256
JWT signatures; this version already existed transitively through authentication.

### Jobs and authorization

`BackgroundJob` has a unique logical occurrence key, due time, bounded attempts,
lease token/expiry, outcome and sanitized error code. Claims use `FOR UPDATE SKIP
LOCKED` plus a short advisory lock acquired before the selection statement takes its
READ COMMITTED snapshot; overlapping reconciliation or the same resource
is excluded. Heartbeats renew a two-minute lease. Expired CRM jobs may retry at most
three times with backoff. An interrupted automation or delivery needs attention.
An in-flight email becomes UNCERTAIN, never a retry candidate.

The dedicated bearer secret authorizes processing persisted work, not creating arbitrary
instructions. The public route accepts no actor, recipient, job id or payload. An
AsyncLocalStorage context binds a claimed job to its persisted staff delegation.
Every capability check re-reads the current lease and active staff account and limits
capabilities by job kind. Background work cannot approve a message or change schedules.
The human identity is retained in audit records. `SchedulerHeartbeat` distinguishes a
quiet running worker from one that stopped checking for work.

Periodic CRM reconciliation is explicitly configured by staff. Signed notifications
coalesce into one future reconciliation per minute. Assisted automation occurrences
prepare drafts only; draft creation and the occurrence's generated-campaign pointer
commit together, preventing an orphan draft from causing a duplicate after a crash.
No external article is automatically approved. Missed assisted occurrences coalesce
to the next draft preparation; missed customer start windows never silently send late.

### Monday webhook trust

The read-only challenge is echoed without authentication or persistence. Events require
an HS256 JWT signed by the Monday app **Signing Secret**, with expiration, issued-at,
exact endpoint audience and configured account-id checks. Accepted boards are the
existing four board constants. Only event identity metadata is retained; webhook column
values never change CRM state. Reconciliation reads Monday through the existing
query-only port and preserves locally owned consent and opt-outs.

Monday does not sign every generic board webhook. Operators must use a Monday app
integration and create its board subscriptions through the corresponding app OAuth
token. An unsigned personal-token webhook is not an acceptable fallback. This change
does not register live subscriptions, modify Monday data, or supply a signing secret.

### Customer dispatch

The customer method is a separate `sendCustomer` method on the production port. The
existing `send` method retains the hard-coded one-address provider-pilot envelope.
Neither SAFE TEST nor QA is a customer-delivery path.

Actual customer delivery requires all of:

- Production process; environment `PRODUCTION_DELIVERY_ENABLED=true`,
  `SEND_MODE=PRODUCTION`, `AXIS_DELIVERY_RELEASE_APPROVED=true`.
- Configured Resend, verified SPF/DKIM snapshot no older than 24 hours, and explicit
  operator `PRODUCTION_DOMAIN_REVIEW_CONFIRMED=true`. DMARC remains UNKNOWN in the
  provider read model; the flag records an operator review, not provider verification.
- HTTPS public unsubscribe configuration, verified provider webhook configuration,
  enabled scheduler and a recent worker heartbeat.
- Current complete audience and exact production-message approval from another active
  authorized person, including when the creator is ADMIN.
- Confirmed GRANTED consent for every destination at scheduling. UNKNOWN remains a
  planning warning and never establishes a basis for actual customer delivery.
- Explicit human text `SEND N CUSTOMERS`, where N is the resolved destination count,
  and a delivery time within 90 days.

The scheduling transaction revalidates content, audience and approval and records the
canonical DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED transitions with actors.
It freezes the entire canonical newsletter document, including images, branding and
source metadata. Future library edits cannot alter queued or sent history. Production
approval now hashes the production sender and a document without the TEST notice;
older production approvals require review again. SAFE TEST hashes are unchanged.

The ledger is unique by campaign/address and retains its approved final audience.
The worker claims at most 20 never-attempted rows per batch. It reuses indexed, scoped
queries through the canonical audience resolver immediately before each submission,
then re-reads high-authority communication vetoes. Changed segmentation, archived CRM,
denied/unknown consent, suppression and unsubscribe can only remove destinations.
Draft edits and scheduling are serialized on the campaign row.

Submission attempts are persisted before I/O; attempted rows are never resubmitted,
including provider failures and UNCERTAIN outcomes. A database-backed provider slot
permits at most one customer submission per 550 ms across replicas. Resend's 24-hour
idempotency retention is additional protection, not the retry safety mechanism.
Campaign SENT means submission work completed, not every email delivered. Reports
reserve DELIVERED for provider-confirmed delivery. Cancellation before execution
creates a terminal CANCELED record and preserves its prepared history.

An initial delivery more than five minutes late needs explicit rescheduling. An
interrupted SENDING campaign can continue only after a new human confirmation, and
only its never-attempted rows are eligible. A signed event may resolve an uncertain
outcome when the provider message id is known; an unknown id requires external provider
reconciliation and never an automatic resend.

### Events and reporting

Persist verified normalized receipts before correlation. An early webhook survives
until the exact provider-message-id/address pair exists. Apply global suppressions and
opt-outs once immediately; correlate campaign history later without repeating those
effects. Row locks serialize duplicate/out-of-order events. No email-only guess may
attach an orphan to the newest campaign.

ACCEPTED is a dedicated event category. OPENED/CLICKED update first-occurrence facts,
not delivery state. Reports use authoritative recipient timestamps for totals and
historical delivery classification, avoiding the former acceptance-as-delivery bucket.
Reports provide UTC campaign-creation cohorts, 20-campaign pages, 100-recipient pages,
status filters, unique engagement, daily activity, recent events and an authenticated,
audited CSV export capped at 20,000 rows with spreadsheet-formula protection.
Privacy tools and missing tracking events limit what open/click figures establish.
Known pilot receipts are marked reconciled against the exact test-send id/address,
without creating any customer recipient or campaign event.

### Operations and verification

The default runtime and checked-in examples keep delivery disabled. Hosted startup
accepts a coherent operator release configuration; no UI changes environment flags.
Electron still forcibly disables customer delivery. The separate worker image receives
only its trigger secret and endpoint, without database or provider credentials.

The disposable-container rehearsal proves two app replicas, an authenticated worker
preparing one draft with no recipient rows, database outage/recovery, shared login
protection and encrypted restore. The benchmark seeds only synthetic data at 500,
2,000 and 10,000 contacts, measures authenticated HTTP routes with concurrency 1/5/10,
and records route latency, error counts, throughput and resource snapshots. It does
not establish a production SLA or provider/mailbox delivery capacity.

Vitest concurrency is limited to four workers so independent application pools cannot
exhaust the default PostgreSQL connection budget. Explicit concurrent claim/send tests
still run concurrently within a test.

The 2026-09-06 runtime correction versions the existing Prisma singleton by generated
model/field shape, migration manifest, validated database target and pool configuration.
An incompatible cached client is replaced and its pool drained. An obsolete generated
module fails explicitly. Health requires this client check as well as database migrations;
it never reports readiness solely because a separate SQL connection succeeded.

## Alternatives and consequences

Redis/BullMQ would add a second durable system and operational burden without a measured
need at AXIS's contact scale. In-process timers alone lose work across restart. A
third-party webhook-triggered CRM mutation would bypass Monday's source-of-truth model.
Automatic retries after unknown email outcomes would risk duplicate customer mail.

The design needs an operator-owned HTTPS deployment, worker process, external secrets,
Monday app subscriptions and Resend/domain setup before live use. These are operational
configuration and release actions, not missing implementation. No live delivery,
subscription registration, DNS change or external deployment was performed.

## Primary references

- [Monday webhook authentication and retries](https://developer.monday.com/api-reference/reference/webhooks)
- [Monday integration authorization](https://developer.monday.com/apps/docs/integration-authorization)
- [Resend idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys)
