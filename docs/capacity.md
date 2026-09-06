# Capacity measurements — 2026-09-05

The final synthetic run completed **540 authenticated HTTP requests with zero errors**.
At 10 concurrent requests, aggregate p95 was **364 ms for 2,000 contacts** and
**1,274 ms for 10,000 contacts**. This is a local workload measurement, not a hosted SLA.

Raw reproducible evidence: [capacity-benchmark-2026-09-05.json](capacity-benchmark-2026-09-05.json).
Run timestamp: `2026-09-05T13:41:39.169Z`.

## Environment and workload

- Windows host with Docker Desktop, Intel Core i9-12900K, 24 logical CPUs, 63.7 GiB host RAM.
- Two non-root application replicas on read-only filesystems, PostgreSQL 16, and a real
  authenticated scheduler worker. Each app's main database pool is capped at three;
  health checks and test tools also use connections. The final database snapshot had 12.
- Final app image: `axis-ccp:ops-foundation-local`, manifest digest
  `sha256:0c9d3dc1e03090459e0eb884e664a4b4f415e4e142ef8970b3d1b27b8152fee4`.
- Synthetic contacts have an equal number of companies and linked communication records.
  Recipient-ledger rows accumulate across the three fixture sizes: 500, 2,500 and 12,500.
- Each size/concurrency combination makes 60 requests after warming both replicas,
  spread across customers, communication addresses, reports, campaign detail,
  newsletter audience readiness and database readiness. Latency includes downloading
  the full HTTP response. No assets, browser rendering or user think-time are measured.
- No live customer data, email submission, Monday request or provider throughput test.

## Observed results

| Contacts | Companies | Ledger rows | Concurrency | Requests | Errors | p50 ms | p95 ms | Requests/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 500 | 500 | 1 | 60 | 0 | 26 | 54 | 33.79 |
| 500 | 500 | 500 | 5 | 60 | 0 | 34 | 90 | 128.07 |
| 500 | 500 | 500 | 10 | 60 | 0 | 48 | 238 | 135.85 |
| 2,000 | 2,000 | 2,500 | 1 | 60 | 0 | 24 | 70 | 34.10 |
| 2,000 | 2,000 | 2,500 | 5 | 60 | 0 | 33 | 144 | 92.85 |
| 2,000 | 2,000 | 2,500 | 10 | 60 | 0 | 53 | 364 | 93.53 |
| 10,000 | 10,000 | 12,500 | 1 | 60 | 0 | 28 | 198 | 18.30 |
| 10,000 | 10,000 | 12,500 | 5 | 60 | 0 | 36 | 482 | 34.49 |
| 10,000 | 10,000 | 12,500 | 10 | 60 | 0 | 60 | 1,274 | 34.09 |

Audience readiness is the heaviest route: its p95 at 10,000 contacts and concurrency 10
was 1,314 ms. It resolves the full eligible audience rather than a paginated list.
The results support retaining PostgreSQL and bounded pools for the initial internal
workload. They do not establish the maximum supported number of contacts or users.

Customer provider submissions have a separate global pacing reservation, one slot per
550 ms, and batches of at most 20. Actual throughput also depends on worker polling,
veto checks, provider responses and the account's provider limits. Those were not measured.

## Reproduce and interpret

Build the runner, migrator, backup and worker images with the local tags used by
`ops/container-smoke.mjs`, then run `npm run ops:benchmark`. The tool owns and cleans a
randomly named Docker network and database. It never loads operational `.env` values.
It writes `var/capacity-benchmark.json` and `.md`; retain a new dated evidence file when
comparing a deployment or code revision.

The same rehearsal passed unmigrated-readiness refusal, two-replica sessions and login
throttling, one assisted draft through the worker without recipient rows, database
outage/recovery without app restart, encrypted backup/restore and refusal to restore
over an occupied target.

Before committing to a hosted service level, repeat this workload on the selected host
with its real CPU/memory limits, database latency, storage and TLS proxy. Add a sustained
soak and agreed latency/recovery targets there. A short warmed local run cannot establish
long-running stability, failover availability, delivery speed or mailbox engagement.

See [workflow operations](workflow-operations.md) for deployment and release configuration.
