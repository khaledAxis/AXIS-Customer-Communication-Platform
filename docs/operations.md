# Hosted operations runbook

The portable hosting baseline is implemented in [ADR-0034](decisions/0034-hosted-operations-foundation.md).
It is tested locally; no external environment, scheduled backup or alert subscription is provisioned
by these files. Customer delivery remains locked. The host's infrastructure operator owns this runbook.

## Release artifacts and prerequisites

- Node.js 24 for development/CI and the application image; Docker with Linux containers.
- PostgreSQL 16, privately reachable from the application, with durable storage and managed recovery
  or a documented maintenance/backup procedure. Never expose its port publicly.
- An HTTPS public origin, TLS renewal, a reverse proxy/load balancer and Cloudinary media storage.
- A stable, securely generated Auth.js secret shared by every replica, plus external runtime secrets.
- Separate runtime, migration and backup credentials with appropriate database privileges. Runtime
  needs application DML and read access to `_prisma_migrations`; migrations require schema ownership.
  `pg_dump` needs read access to all application tables/sequences. Backup key custody must be separate
  from the archive location. Test the chosen grants on staging; this repository does not provision roles.

Build all images from the same reviewed revision. Examples use `RELEASE` as a unique revision tag;
substitute the actual revision. Never put database/provider secrets in build arguments or the context.

```sh
docker build --target runner --build-arg AXIS_DEPLOYMENT_ID=RELEASE -t axis-ccp:RELEASE .
docker build --target migrator -t axis-ccp-migrate:RELEASE .
docker build --target backup -t axis-ccp-backup:RELEASE .
docker build --target worker -t axis-ccp-worker:RELEASE .
```

Promote the exact same built image to all instances. Published releases should use immutable digests
and retain the previous application/migrator pair. Base image tags and the npm lockfile need regular
patch review; these files do not constitute a vulnerability-monitoring service.

## Configure and start

Copy `ops/hosted.env.example` to a restricted location outside the checkout, such as
`/etc/axis/runtime.env` (operator-owned, mode `0600`). Fill in actual values there. Do not print the
completed file, include it in support attachments, or run Compose's expanded configuration into logs.

`AUTH_URL`, `NEXTAUTH_URL` and `PUBLIC_APP_URL` must use the same HTTPS origin with no path or query.
Set `MEDIA_PROVIDER=cloudinary`. The startup wrapper validates required configuration before Next.js
starts with the hosted TEST baseline by default. ADR-0035 permits a coherent external operator
customer-release configuration; partial activation is refused and hosted pilot/QA remain off.
SAFE TEST Gmail still requires its approved workflow and explicit credentials. No startup code sends email.
Configuration shape does not prove that a provider or database is reachable.

The supported secret variables also accept a `_FILE` companion: `DATABASE_URL`, `AUTH_SECRET`,
`CLOUDINARY_URL`, `MONDAY_API_TOKEN`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`SCHEDULER_TRIGGER_SECRET`, `MONDAY_SIGNING_SECRET`.
Mount each referenced file read-only at that path using the host's secret system or a Compose override.
The supplied Compose file does not mount arbitrary host paths. Setting both a value and a file is refused.

Set these **Compose interpolation variables** in the operator's environment:

```sh
export AXIS_IMAGE=axis-ccp:RELEASE
export AXIS_MIGRATOR_IMAGE=axis-ccp-migrate:RELEASE
export AXIS_ENV_FILE=/etc/axis/runtime.env
export AXIS_HTTP_PORT=3000
```

Take and verify a backup before a release touching schema. Review its migration for lock duration and
compatibility. Run migrations once with the migration credential, then start the application with its
runtime credential; use distinct external env files for these roles:

```sh
AXIS_ENV_FILE=/etc/axis/migration.env docker compose -f ops/compose.yaml --profile tools run --rm migrate
docker compose -f ops/compose.yaml up -d app
curl --fail http://127.0.0.1:3000/api/health/ready
```

The root `compose.yaml` remains local development PostgreSQL. The hosted `ops/compose.yaml` does not
start or migrate that database. Do not use operational credentials with automated test commands.

Configure the HTTPS edge using `ops/nginx.conf.example` as a template. Replace the origin/certificate
paths and check the config with `nginx -t` before reload. The template binds upstream traffic to
loopback, overwrites forwarding headers, throttles login POSTs by source IP, and omits URLs/cookies
from access logs. Configure a default virtual host that rejects unexpected hostnames. If another
trusted proxy sits ahead of Nginx, configure its exact trusted IPs and real-IP handling; otherwise the
IP limit sees that proxy as one caller. Do not trust client-supplied forwarding headers.

Restrict `/setup` to the operator at the edge until the first administrator exists, then block anonymous
setup traffic at the edge. The application also permanently closes setup after the first administrator.
Only staff pages require login: unsubscribe, public newsletters, media and signed provider webhooks
retain their designed public behavior. Verify those routes over HTTPS when a domain is provisioned.

## Health, monitoring and incident signals

| Probe/signal | Meaning | Host action |
| --- | --- | --- |
| `/api/health/live`, HTTP 200 | Next.js answers; no dependency check | Restart only for a persistent failure, allowing startup grace |
| `/api/health/ready`, HTTP 200 | Database reachable and expected migrations completed | Admit this instance to the load balancer |
| Readiness HTTP 503 | Connection/query failure, missing/mismatched or unfinished migration | Remove from traffic; inspect DB/migration state |
| `request_failed` JSON event | Framework request failure, route type and timestamp only | Track rate with proxy 5xx and latency |
| `backup_completed` / failed exit | Encrypted archive and manifest successfully written / operation failed | Alert on any failed run or missing expected completion |

Both health endpoints return only `status` with `Cache-Control: no-store`. Readiness also returns
`Retry-After: 5` when unavailable. The container's Docker healthcheck uses readiness; Docker marks an
unhealthy container but does **not** automatically restart it merely because it is unhealthy. The load
balancer/orchestrator must act on readiness. The Nginx sample restricts probes to loopback: explicitly
allow the real internal monitoring source if needed. Probe each replica directly, not just the balancer.

Start with probes every 15 seconds, a 30-second startup grace, and an alert after three consecutive
failures. Monitor HTTP 5xx rate, request latency, container memory/restarts, PostgreSQL active/waiting
connections, storage capacity, backup age and certificate expiry. Agree thresholds against a staging
baseline. There is no dashboard/alert backend or external notification subscription in this change.

The custom instrumentation event excludes raw errors, paths, query strings, headers and actors.
Next.js, PostgreSQL, adapters and Nginx **error** logs may still contain diagnostic details. Restrict
log access and retention; review/redact exported logs. Do not claim the entire logging stack is sanitized.

For 503 readiness: confirm DB connectivity, connection capacity and migration status using the explicit
migrator credential. Do not repeatedly restart healthy processes during a DB outage. Do not delete
migration history or change checksums to make readiness pass. Repair a failed migration deliberately.
The checksum manifest recognizes historical Windows CRLF and LF files; regenerate with
`npm run ops:manifest` whenever a migration is added, and include it in the same change.

## Encrypted backups and restore drills

`ops/database-backup.mjs` uses PostgreSQL client tools. Run via the backup image or Node with `pg_dump`,
`pg_restore` and `psql` on PATH (`PG_BIN` optionally names their directory). Keep client major version
aligned with PostgreSQL; this image targets PostgreSQL 16. This is a complete database archive,
including locally owned consent, unsubscribe, suppression and audit state. It does not back up
Cloudinary assets, environment secrets, database roles, host configuration or provider accounts.

Provision an operator-only secret directory and backup directory outside the repository. Create a
random 32-byte base64 key and write it **directly to a protected file**, not to terminal output. Keep
an independently recoverable copy in the organization's secret vault. Losing it loses the backups.

Create protected files containing the source DB URL and key. The connection URL accepts `schema=public`
and `sslmode`; TLS defaults to `verify-full`. Mount the provider's CA bundle and set
`BACKUP_SSL_ROOT_CERT` if needed. `sslmode=disable` is for isolated local drills only. Passwords are
passed to pg tools through a temporary `0600` password file, never command arguments.

Example paths **inside** the backup container, in a non-secret `/etc/axis/backup.env`:

```dotenv
BACKUP_DIR=/backups
BACKUP_DATABASE_URL_FILE=/secrets/database.url
BACKUP_ENCRYPTION_KEY_FILE=/secrets/backup.key
BACKUP_RETENTION_DAYS=14
```

Mount the secret directory read-only and the archive directory writable. Run as a non-root UID/GID
that owns the archive directory and can read the mounted secrets; substitute that numeric pair for
`1000:1000`. Restoration's `/tmp` needs enough capacity for one decrypted archive.

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 1000:1000 --tmpfs /tmp:rw,noexec,nosuid,size=256m,mode=1777 \
  --env-file /etc/axis/backup.env \
  --mount type=bind,source=/etc/axis/backup-secrets,target=/secrets,readonly \
  --mount type=bind,source=/srv/axis/backups,target=/backups \
  axis-ccp-backup:RELEASE create
```

For a containerized DB on the same host, add its private Docker network. `localhost` inside the backup
container is not the database host. Archives use `axis-<timestamp>-<uuid>.enc` plus `.enc.json`.
`pg_dump` streams directly into authenticated encryption; plaintext does not land in the backup
directory. An exclusive `.axis-backup.lock` prevents concurrent create/prune. After a killed process,
remove a stale lock only after verifying no backup/prune process is running, then investigate incomplete
archive pairs. Normal failures clean up their own partial output.

Schedule the same command daily using the chosen host's scheduler, capture its exit status and alert
on failure or no successful archive for more than 26 hours. Daily/14-day retention is a starting
configuration, not an agreed recovery objective. Copy **both** files offsite with encryption, access
controls and immutability appropriate to the host. Verify that offsite copy before retention. A successful
local backup does not prove offsite protection or recovery. Managed point-in-time recovery is a separate
database feature and is not configured here.

Run the command with `prune` for a count preview; `prune --apply` deletes old complete pairs while
preserving the newest two. It never recursively deletes the directory. Do not automate destructive
retention until backup frequency, offsite verification and retention policy have been agreed.

For a restore drill:

1. Provision a **fresh empty** database named, for example, `axis_recovery_restore`, isolated from
   application traffic. Do not use `axis_ccp_dev`, `axis_ccp_test` or the source database.
2. Create a protected target connection file. Add `RESTORE_DATABASE_URL_FILE` pointing to its mounted
   path and `RESTORE_CONFIRM_DATABASE=axis_recovery_restore` to the restore process's configuration.
3. Run the same backup image and mounts with `restore /backups/<archive>.enc`. It checks the checksum,
   refuses any existing user relation, authenticates the archive fully, and calls `pg_restore` in one
   transaction. Nothing is restored on authentication failure; temporary plaintext is cleaned afterward.
4. Validate migration history and representative record counts, local consent/unsubscribe/suppression
   records and audit history. Test application behavior with every provider disabled in an isolated
   recovery environment. Real recovered CRM data must **never** enter automated test fixtures.
5. Record the archive timestamp, observed recovery point and elapsed recovery time. Delete the drill
   database only through the host's explicit operational procedure after review.

Repeat at least monthly and after changes to credentials, encryption or database versions. A real
disaster cutover requires explicit operator review: pause traffic, validate the restored data, and
point the app at the reviewed replacement database. The tool intentionally has no overwrite mode.

## Scaling and rollback

Use identical application images, the same public origin and Auth.js secret, the same PostgreSQL
database and Cloudinary account. JWT sessions and hosted login allowances are shared; no session
affinity is required for authentication. All permission decisions still re-read the user row.

Bound total connection demand before adding instances:

```text
replicas × (DB_POOL_MAX + 1 health connection) + migration/admin reserve <= DB max_connections
```

Default per-app pool is 10, connection timeout 5 seconds, statement timeout 30 seconds; the health
pool has one connection with shorter deadlines. E.g. two replicas reserve 22 connections before
admin/migration headroom. Increase only against measured demand and the database's connection budget.
Long CRM operations execute multiple statements; a timeout is per statement, not an entire sync SLA.

The sample Compose service publishes one loopback port. To run two instances on one VM, use separate
Compose project names and distinct `AXIS_HTTP_PORT` values, then add both to the upstream. Do not use
`--scale app=2` with that fixed port binding. Managed platforms should supply equivalent health probes,
resource bounds, private networking and secret injection. This does not make one PostgreSQL server
highly available. Establish realistic load/latency targets before adding replicas.

For a release: build once, test, back up, apply compatible additive migrations, start new instances,
wait for readiness, verify staff login/key pages, then shift traffic and drain the previous instances.
`AXIS_DEPLOYMENT_ID` identifies the build for Next.js deployment skew handling. Independently built
Server Actions can have different build keys; promoting the same image avoids that mismatch. If
future work adds persistent Next.js caches, evaluate cache sharing and invalidation explicitly.

For rollback, restore the prior application image **only if** its schema assumptions remain compatible.
Additional completed migrations alone do not block its readiness; that is not proof of compatibility.
Do not reverse migrations automatically or overwrite the live DB from backup. Keep irreversible schema
changes out of a routine rolling release; use an expand/migrate/contract plan and a separate review.

## Validation and remaining work

```sh
npm run ops:manifest:check
npm run ops:test
npm run test:db:migrate
npm test
npm run lint
npm run typecheck
npm run typecheck:workflows
npm run e2e
```

For the isolated container rehearsal, build the app, migrator, backup and worker targets with the default local tags documented
in `ops/container-smoke.mjs`, then run `npm run ops:smoke`. Alternatively set `OPS_APP_IMAGE`,
`OPS_MIGRATOR_IMAGE`, `OPS_BACKUP_IMAGE`, `OPS_WORKER_IMAGE`. It creates a uniquely named Docker network/database, applies
the real migrations, seeds synthetic accounts/denied consent, runs two read-only app replicas, proves
shared sessions/throttling and one assisted draft through the real worker, interrupts PostgreSQL,
and performs an encrypted restore. It reads no `.env`
and supplies no real provider credential. Cleanup removes only the exact resources owned by that run.
It proves these behaviors, not production throughput. `.github/workflows/ci.yml` repeats the checks
on pushes and pull requests once committed and enabled in GitHub; it does not deploy or publish.

Still required outside this change: a hosting/DNS choice, deployment credentials, backup scheduling and
offsite storage, alert delivery, a measured capacity target, and a staged release rehearsal on that host.
Scheduled reconciliation, Monday webhook intake, durable job execution, gated customer dispatch
and engagement reports are implemented in ADR-0035. Configure them using
[workflow operations](workflow-operations.md). Customer delivery remains disabled by default.
`npm run ops:benchmark` extends the isolated rehearsal with the workload recorded in
[capacity measurements](capacity.md); it does not supply a production capacity commitment.

## References

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) (implementation also checked
  against the installed Next.js 16.3.1 self-hosting and instrumentation guides).
- [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) and
  [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).
- [Docker build secrets](https://docs.docker.com/build/building/secrets/) and
  [Compose services](https://docs.docker.com/reference/compose-file/services/).
- [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
