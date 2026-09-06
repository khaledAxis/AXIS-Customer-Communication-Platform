# ADR-0034: Portable hosting, shared login protection and recoverable backups

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Project owner (authorized infrastructure and scaling work), implementation agent

## Context

The application had a standalone build and isolated tests, but no repeatable hosted release,
health probes, CI workflow or backup/restore tool. The sign-in limiter lived in one process.
Adding replicas would multiply its allowance and local image uploads would not be shared.
The initial workload remains a few staff and 500–2,000 contacts; no queue requirement has emerged.

## Decision

1. Build one Next.js standalone image, plus separate migration and PostgreSQL 16 backup tool
   targets. Run as non-root with a read-only application filesystem. Runtime configuration and
   secret files are external; the Docker build context is allowlisted. No migrations at app startup.
2. Keep deployment portable: Compose behind an HTTPS reverse proxy or the equivalent managed
   container service, with an external PostgreSQL database. The host, DNS and alert destination
   remain operator decisions. This change does not deploy infrastructure or enable sending.
3. Hosted startup forces TEST mode and refuses enabled customer-delivery, provider-pilot or QA
   switches. Cloudinary is required for shared durable media. A narrowly guarded test-only HTTP
   exception requires a database ending `_test`, loopback URLs and no live adapter credentials.
4. Host replicas use the same immutable image, public origin and Auth.js secret. Set the build's
   deployment ID to its revision. Add bounded database pools and timeouts. Budget one additional
   health connection per process. Do not add Redis, BullMQ or a distributed cache.
5. `AXIS_HOSTED=true` selects a PostgreSQL login limiter. An atomic upsert serializes the existing
   eight-attempt/60-second allowance across replicas. Identity keys are HMAC-SHA256 with the shared
   Auth.js secret; plaintext addresses are absent from this table. Errors deny login without a
   local fallback. Indexed, bounded pruning removes expired entries opportunistically. An edge
   IP limit complements the identity limit. Local development and Electron retain their map.
6. Exact public `/api/health/live` and `/api/health/ready` routes expose only status. Readiness
   requires connectivity and completed migrations matching the image's committed checksum manifest;
   it never calls CRM, media or email providers. A dedicated one-connection pool, short timeouts,
   in-flight coalescing and a one-second cache bound probe work. Failed migrations block readiness.
   Additional completed migrations are allowed for compatible application rollbacks. Historical
   LF/CRLF checksums are both recognized; new migration files are normalized with `.gitattributes`.
   This is a migration-history check, not a complete schema-drift detector.
7. Stream `pg_dump` custom archives directly into AES-256-GCM encryption. Store a checksum manifest
   beside each ciphertext. Keep the 32-byte key separately. Authenticate the archive before invoking
   `pg_restore`; restoration uses a private temporary file and one transaction. Refuse any nonempty
   target, the source database name, targets without `_restore`, or missing exact confirmation.
   Retention is dry-run by default and always retains the two newest archive pairs. A lock excludes
   overlapping create/prune operations. Offsite storage, scheduling and key custody belong to the host.
8. CI uses a synthetic PostgreSQL service and no operational/provider secrets. It checks migrations,
   lint, types, unit/integration tests, browser flows, image builds, and a two-replica container drill
   with database interruption and encrypted restore. It neither publishes nor deploys images.

## Alternatives considered

- **Redis for throttling:** an additional service is unnecessary at this workload; PostgreSQL already
  provides the required atomicity. Reconsider if measured contention warrants it.
- **Migration on every replica startup:** concurrent rollout and runtime DDL privileges complicate
  recovery. Use one explicit deployment step with a separate credential instead.
- **Automatic restore over the operational database:** makes accidental data loss too easy. Recover
  into a separate empty database, inspect it, then perform an operator-controlled cutover.
- **A host-specific deployment now:** hosting has not been selected. Portable artifacts are reviewable
  and tested without imposing a paid service or creating an external resource.

## Consequences

The app can run in multiple identical processes with shared login protection and shared hosted media.
The rehearsal proves these behaviors, not a throughput target or a highly available database.
Operators still need TLS/DNS, database availability, offsite backup copies, an agreed recovery objective,
restore drills and alerts. A daily archive alone provides no point-in-time recovery.

The new `AuthRateLimit` migration must be deployed before starting hosted instances. A failed database
also prevents new logins by design. Independent rebuilds or destructive schema changes require a
deliberate rollout strategy; passing readiness does not prove an older image is schema-compatible.
Production dispatch, scheduled jobs, Monday webhook intake and engagement reporting remain unfinished.
See [the operational runbook](../operations.md).
