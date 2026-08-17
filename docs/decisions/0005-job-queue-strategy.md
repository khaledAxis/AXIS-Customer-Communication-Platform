# ADR-0005: Defer Redis/BullMQ; in-process scheduling first

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

Scheduling and sending eventually need background execution: a due-campaign trigger and iteration over
recipients. The brief lists a "worker/job queue architecture **when** scheduling/email sending
requires it" and "Redis/BullMQ **only when justified** rather than added prematurely." Current scale
is small (~500–2,000 contacts, low campaign frequency), so a single campaign send is a few hundred
provider calls — not obviously beyond what a single process can do.

## Decision

**Do not add Redis or BullMQ for the MVP.** Start with the simplest mechanism that is safe:
- Store `sendAt` on the campaign. A **minimal, secured trigger** (a cron-invoked route handler or a
  small in-process interval) selects **due** `SCHEDULED` campaigns and calls the send service.
- The send service is **idempotent** via a unique **`CampaignRecipient` ledger** row per
  (campaign, contact), so a send is **safe to retry and resumable** without a queue.
- Design the schedule/send **use-case interfaces** so they can later be invoked by a queue worker
  **without changing domain logic**.

Introduce a **worker process + BullMQ on Redis** later, recorded in a superseding ADR, **only when a
concrete trigger is hit**, e.g.: sends exceed request/function time limits; we need cross-instance
concurrency control, rate limiting, or exponential backoff beyond the ledger+cron approach; or
recurring automations (M13-era) require durable scheduling.

## Alternatives Considered

- **BullMQ + Redis now:** adds infrastructure (a Redis service, a separate worker deployable,
  ops overhead) before any requirement justifies it — contradicts the brief and the "no premature
  infrastructure" principle.
- **Cloud-managed queue (SQS, etc.):** ties us to a platform prematurely and is overkill at this
  scale.
- **Pure in-request sending with no trigger:** cannot handle scheduled/future sends; rejected.

## Consequences

- Minimal moving parts for the MVP; the idempotent ledger provides safety without a queue.
- Sending must stay within the runtime's execution limits; if it cannot, that is the documented
  trigger to adopt a worker/queue (new ADR).
- A cron/trigger endpoint must be secured (secret/allowlist) so it cannot be invoked to force sends.
- The upgrade path is preserved by keeping send/schedule logic in services behind clean interfaces.
