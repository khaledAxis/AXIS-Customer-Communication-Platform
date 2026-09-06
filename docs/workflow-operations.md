# Scheduled workflows and customer delivery

Implementation: [ADR-0035](decisions/0035-durable-workflows-customer-dispatch-and-reporting.md).
These instructions configure the implemented paths. The repository defaults remain TEST,
and this work did not activate customer delivery or register live external subscriptions.

## Start a scheduler

Provision `SCHEDULER_ENABLED=true` and a dedicated random `SCHEDULER_TRIGGER_SECRET`
of at least 32 characters on the application. Do not reuse Auth.js or provider secrets.
The secret may instead be mounted through `SCHEDULER_TRIGGER_SECRET_FILE`.

Build the worker from the same revision as the app:

```sh
docker build --target worker -t axis-ccp-worker:RELEASE .
```

Copy `ops/worker.env.example` outside the checkout, restrict its permissions, and set
the same trigger secret there. The worker receives no database, Monday or Resend key.
Set `AXIS_WORKER_IMAGE=axis-ccp-worker:RELEASE` and
`AXIS_WORKER_ENV_FILE=/etc/axis/worker.env` in the Compose operator environment, then:

```sh
docker compose -f ops/compose.yaml --profile scheduler up -d app worker
```

For a managed process without Docker, provision the equivalent environment and run
`npm run ops:worker`. Remote endpoints require HTTPS; HTTP is limited to loopback or
the private Compose service. The worker refuses redirects. It checks every five
seconds, backs off on failures and shuts down on SIGTERM/SIGINT. Multiple workers can
share the queue; PostgreSQL leases, resource exclusion and provider pacing coordinate them.

Open **Operations**. A recent heartbeat must say **Checking for work**. Saving a CRM
schedule records the signed-in staff member's delegation. Pausing that schedule stops
periodic CRM work and notification processing. Deactivating the delegated account stops
its work too. Automations have their own pause/resume controls and only prepare drafts.
The exact tick route never accepts an actor, email address or arbitrary job instruction.

Monitor `scheduler_tick_failed`, missing heartbeat, and jobs needing attention alongside
the host's health/backup signals. Operations shows the latest 100 jobs. CRM errors can
be retried after correcting configuration; uncertain email attempts cannot.

## Register Monday notifications

Use a Monday app integration whose OAuth token creates the relevant board webhook
subscriptions. Configure its **Signing Secret** as `MONDAY_SIGNING_SECRET`, the allowed
account as `MONDAY_ACCOUNT_ID`, and `MONDAY_WEBHOOK_ENABLED=true`. The audience claim
must match `PUBLIC_APP_URL + /api/webhooks/monday` exactly. Register changes/deletions
relevant to the four boards listed in `src/domain/crm/mondayColumns.ts` through the
Monday app's authorized setup process. This repository does not register them itself.

The read-only URL challenge is supported. Actual notifications must have a valid
short-lived HS256 authorization JWT. Generic unsigned personal-token webhooks are
refused; do not disable verification to make them work. Duplicate notifications return
success once accepted. A paused/unconfigured intake returns unavailable. Signed events
store identity metadata and queue a reconciliation at the next minute boundary. Their
column values never mutate CRM data. Periodic reconciliation repairs missed notifications.

See [Monday webhooks](https://developer.monday.com/api-reference/reference/webhooks)
and [integration authorization](https://developer.monday.com/apps/docs/integration-authorization).

## Review and release customer delivery

First configure a reachable HTTPS origin, public unsubscribe and Resend webhooks. Verify
the footer URL and signatures on the deployed environment. Refresh the provider domain
snapshot from **Email setup**: SPF and DKIM must be verified and checked within 24 hours.
An infrastructure operator must review the actual DNS/domain/DMARC configuration;
provider DMARC remains **Unknown** because it is not provider-verifiable here.

An explicitly authorized operator release sets the following in the external runtime
configuration, followed by an app restart. No browser or database setting can do this:

```dotenv
PRODUCTION_EMAIL_PROVIDER=resend
PRODUCTION_DELIVERY_ENABLED=true
SEND_MODE=PRODUCTION
AXIS_DELIVERY_RELEASE_APPROVED=true
PRODUCTION_DOMAIN_REVIEW_CONFIRMED=true
SCHEDULER_ENABLED=true
```

Provision the real Resend key, webhook secret and scheduler secret separately. These
flags alone are insufficient: provider/domain/public URL/heartbeat checks must pass.
The hosted startup wrapper rejects partial release configuration. Electron always
forces customer delivery off. Setting the delivery flag false and restarting disables
new submissions; already accepted mail remains the provider's responsibility.

For each newsletter:

1. Prepare the final audience with documented GRANTED consent for every intended
   destination. UNKNOWN remains a planning warning but blocks actual scheduling.
2. A different active MANAGER/ADMIN reviews the exact customer message in **Readiness**
   and approves its content and audience. ADMIN cannot self-approve.
3. An authorized signed-in person types the exact `SEND N CUSTOMERS` phrase and picks
   a delivery time in their local timezone. The server receives an absolute timestamp.
4. The immutable approved message and audience are queued. Follow execution under
   **Operations** and **Reports**. Acceptance and confirmed delivery are distinct.

Scheduling refuses stale preparation and concurrent content/audience changes. Reload and
review the unchanged instruction after a transient handoff refusal. If an already
prepared ledger belongs to a different final audience, duplicate the newsletter for
the newly approved audience; old provenance is preserved rather than rewritten.
Library edits never change a queued document. A changed sender identity or revoked
approval blocks further submissions. Eligibility is recomputed per address immediately
before its attempt, including CRM changes that occur within a batch.

An unstarted delivery more than five minutes late needs an explicit **Reschedule after
review** action. An interrupted SENDING delivery may **Continue unattempted destinations**
after renewed typed confirmation. Neither action retries attempted/uncertain addresses.
Canceling a scheduled delivery closes it and retains prepared history.

## Interpret reports and reconcile outcomes

Overview dates select newsletters by their UTC creation dates; the figures then include
all observed outcomes for that cohort. The campaign report covers its complete lifetime.
Opens/clicks are unique recipient observations, subject to privacy tools and tracking
availability. Daily activity is unique per day and is not additive across days.
Unsubscribe counts include known campaign attribution; unattributed global opt-outs still
block every applicable future delivery. CSV exports require login, are audited, neutralize
spreadsheet formulas and refuse more than 20,000 rows rather than silently truncating.

Unmatched verified events wait for an exact provider message id and address. Their
suppression/opt-out effects apply immediately. Scheduler ticks and dispatch completion
reconcile matching receipts. Events without a known message id never attach to an
arbitrary campaign. Old acceptance events that used the delivery category are not proof
of delivery: reports use the authoritative recipient delivery timestamp.

UNCERTAIN means the provider may have received the message. Check the Resend dashboard
and retained provider evidence. If the message id is known, signed events can reconcile
it. If no id was persisted, this version preserves the uncertainty instead of guessing
or resending. [Resend idempotency keys expire after 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys);
they do not make indefinite retries safe. A campaign marked SENT means submission work
finished, not that every recipient received or read the newsletter.

## Rehearse capacity and recovery

Build app/migrator/backup/worker images with the tags expected by `ops/container-smoke.mjs`
or set its documented `OPS_*_IMAGE` environment overrides. Run `npm run ops:smoke` for
the worker, two-replica, outage and encrypted-restore rehearsal. `npm run ops:benchmark`
adds synthetic fixtures and concurrent authenticated HTTP measurements. Both own and
clean only randomly named disposable containers and never read operational `.env` values.
Benchmark artifacts are written to `var/capacity-benchmark.json` and `.md`.

See [capacity measurements](capacity.md) for workload scope, observed limits and the
difference between local measurements and a production capacity commitment.
