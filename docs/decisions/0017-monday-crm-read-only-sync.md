# ADR-0017: Read-only Monday CRM synchronization

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Relates to:** implements the `CrmSource` port promised by ADR-0007 (Monday is the source of truth) on the data model fixed by ADR-0009.

## Context

The platform could compose, preview and test-send newsletters, but had no customers.
Monday.com holds the real CRM: ~1,215 companies, ~1,423 contacts, a 174-item product
catalogue and 154 customer-owned products/subscriptions.

The data is messy in ways that matter: emails repeat across records, many companies have
no email at all, contacts may belong to zero, one or several companies, and a separate
bookkeeping address exists that must never receive marketing.

## Decision

### 1. A port with no write method

`CrmSource` exposes `checkConfiguration()` and `fetchBoard()`. There is no create,
update or delete. Read-only is a property of the type, not a rule someone must remember;
a mutation is unrepresentable. `MondayCrmSource` is the only file aware of GraphQL, and
a test greps the whole CRM implementation for mutation constructs.

### 2. Identity is the composite key, never email

Every upsert keys on `(mondayBoardId, mondayItemId)`. Emails repeat freely in this CRM —
one address appears on up to four separate contacts — so every CRM record is preserved
independently while `CommunicationAddress.normalizedEmail` stays globally unique. That
split is what lets delivery deduplicate later without losing CRM provenance.

### 3. `board_relation` requires the typed fragment

From API version 2024-10 a `board_relation` column returns **null for both `text` and
`value`**. Linked ids are only reachable through
`... on BoardRelationValue { linked_item_ids }`. The first live sync produced **zero**
company↔contact links because of this; the typed fragment produced 1,404. Worth recording
because the generic fields fail silently rather than erroring.

### 4. Accounting email is excluded structurally

`CompanyProjection` carries `accountingEmail` but deliberately has **no**
`accountingEmailNorm`, and `communicationCandidates()` only ever returns normalized
addresses. A bookkeeping address therefore cannot become a newsletter target by
accident — verified live: 1,319 distinct campaign emails, 1,319 communication addresses,
zero traceable to an accounting-only address.

### 5. Communication state is create-only

`ensureCommunicationAddress()` creates a row or does nothing. It never updates.
`language`, `consentStatus`, `emailStatus`, unsubscribe and suppression are locally owned
and survive every resync — including when Monday changes a record's email, in which case
the old address and its history are left intact and the new one is created alongside.

### 6. Missing records are archived, and mass archival is refused

A record absent from Monday is marked `archivedAt`, never deleted, so campaign history
and communication state survive.

Added after a real incident during this milestone: an **anti-mass-archival guard**. A
partial, filtered or fake API response is indistinguishable from "everything was
deleted", and the first implementation duly archived all 1,215 companies when a test
source reported only its own items. Archiving more than **20%** of a board's *active*
records is now refused, the run is marked `PARTIAL`, and the reason is recorded. The
denominator is deliberately the active count — measuring against all rows hides a
catastrophic archival behind a small-looking ratio.

### 7. One `SyncRun` per board; one bad item never aborts a run

Each board gets its own run with created/updated/unchanged/archived/error counts, plus a
`SyncItemLog` row per item carrying a data-quality classification (`SENDABLE`,
`NO_EMAIL`, `INVALID_EMAIL`, `INCOMPLETE`). A malformed item is logged and skipped. A
board-level read failure marks that run `FAILED` and **archives nothing** — a failed read
must never look like a deletion.

### 8. Status labels normalize, raw labels survive

Hebrew/English status labels map to the enum; anything unrecognised becomes `UNKNOWN`
with the original text kept in `customerStatusRaw`. Renaming a label in Monday degrades
gracefully instead of corrupting data. Industry and classification lookup rows are keyed
by a hash of the label, so the upsert stays idempotent without needing Monday's internal
label indexes.

## Alternatives Considered

- **Email as CRM identity.** Impossible here: emails repeat across records, and merging
  on email would destroy distinct customers.
- **Hard-deleting records missing from Monday.** Rejected — it would orphan campaign
  history and discard unsubscribe state.
- **Archiving without a guard.** What the first implementation did; it archived the whole
  customer base from one unrepresentative response.
- **Mandatory `companyId` on `Contact`.** Rejected — the real data has orphans and
  contacts shared across companies (14 of them).
- **Writing enrichment back to Monday.** Explicitly out of scope: Monday is the source of
  truth and this platform is a projection (ADR-0007).

## Consequences

- 1,215 companies, 1,423 contacts, 174 products, 154 owned products and 1,404
  company↔contact links are queryable locally; sync is idempotent (a third consecutive
  run created and updated nothing).
- Real data quality is now visible rather than assumed: 1,024/1,215 companies have a
  usable newsletter email, only 70 have an industry set, and 1,046 have no status. That
  is a Monday data-entry matter, surfaced honestly instead of invented.
- Integration tests share the dev database with real CRM data, so archival is tested on
  isolated synthetic board ids and assertions are scoped to run-owned rows.
- A full sync takes ~45 seconds and is sequential per item. Acceptable at this scale;
  batching is the obvious optimisation if the CRM grows.
- Nothing in this milestone can send email, create campaign recipients, or alter Monday.
