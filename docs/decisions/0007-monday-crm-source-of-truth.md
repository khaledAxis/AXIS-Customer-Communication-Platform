# ADR-0007: Monday.com as the CRM source of truth

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** amends ADR-0006 (origin & dedupe reasoning); extends ADR-0002 (persistence), ADR-0004 (integration ports)

## Context

The original foundation modeled **Hashavshevet exported to Excel/CSV** as the origin of customer data,
with this platform as the **system of record** for contacts, and a two-phase CSV **import**
(PREVIEW → COMMIT) with dedupe on normalized email / `sourceSystem + externalId`. That is no longer
correct.

AXIS maintains CRM master data in **Monday.com**. Hashavshevet is **upstream of Monday** and must not
be modeled as a direct source for this platform. This platform must therefore treat **Monday.com as
the single source of truth** for CRM master data and act as a **downstream projection / read model**
for communication, segmentation, campaign building, and reporting.

The system still owns communication-specific state that Monday does not model (email validity,
consent where not mapped, unsubscribe, suppression, campaigns, delivery events, audit), and must
protect that state from being overwritten by CRM sync.

## Decision

1. **Monday.com is the source of truth** for CRM master data (companies/accounts and contacts/people).
2. **This platform is a downstream projection / read model.** It never claims mastery of CRM master
   fields; it mirrors them for local segmentation, campaign building, sending, and reporting.
3. **v1 is read-only toward Monday.** The platform does **not** write unsubscribe, bounce,
   suppression, campaign, or validation state back to Monday. (Outbound/write-back is a future ADR.)
4. **Composite source identity `(mondayBoardId, mondayItemId)`** is the stable natural key for every
   mirrored CRM record — unique — replacing the obsolete `sourceSystem + externalId` dedupe key.
   The local primary key remains a `cuid()`; the composite is a unique constraint used for idempotent
   sync upserts.
5. **Per-field ownership boundary** (authoritative list in `CLAUDE.md` → Domain Rules → *CRM data
   ownership & Monday sync*, and `docs/architecture.md`):
   - **Monday-owned (mirrored, read-only, overwritten by every sync):** company/contact identity and
     names, company↔contact link, phone, job title, email, industry, product/brand interests, tags,
     `language` *(if a reliable Monday field exists — decision 6)*, plus sync/provenance metadata
     (`mondayBoardId`, `mondayItemId`, `mondayUpdatedAt`, `lastSyncedAt`, `rawItem`, `source`).
   - **Locally-owned (never overwritten by sync):** `emailStatus` (our validation result),
     `consentStatus` *(unless a reliable Monday consent field is later mapped)*, `Unsubscribe`,
     `Suppression`, `Campaign`, `CampaignRecipient`, `CampaignEvent`, `AuditLog`, `Segment`, local
     archive flags, and send-mode configuration.
6. **Taxonomy is mirrored/normalized locally, not mastered locally.** Industry / Brand / Product /
   Tag values originate in Monday (status/dropdown labels or connected boards) and are mirrored and
   normalized into stable local ids for segmentation. **No separate local taxonomy-master CRUD is
   built in v1.**
7. **Language:** if Monday contains a reliable language field, mirror it; otherwise `language` is
   locally managed (`HE | AR | UNKNOWN`, default `UNKNOWN`, never silently Hebrew).
8. **Archive-on-delete:** a Monday item deletion **archives** the local projection (set an archive
   marker / `status = ARCHIVED`, record `mondayDeletedAt`) and makes it ineligible for sending. It
   **must not hard-delete** the local record, especially when campaign history exists.
9. **Monday is the normal ingestion path from day one.** CSV/Excel is **not** a primary user
   workflow; it is retained only as an **optional admin/developer fallback** (bootstrap/backfill).
10. **Sync freshness** is stored (`lastSyncedAt` / equivalent per board and record). For v1, stale
    data produces a **visible warning** in the UI rather than automatically blocking sending.
11. **Transport & auditing:** Monday **GraphQL API** for pulls + **webhooks** for incremental change,
    with a scheduled full reconciliation as backstop. Sync executions are audited via **`SyncRun`**
    (one run) and **`SyncItemLog`** (per item), replacing the old `ImportBatch` / `ImportRow`.
    Inbound webhooks are an untrusted boundary: perform the Monday **challenge handshake**, verify the
    signing secret, and record raw events for idempotency.

## Alternatives Considered

- **Keep the platform as system of record, sync Monday as a peer:** creates two masters and
  bidirectional conflict resolution — rejected; contradicts the confirmed decision and adds risk.
- **Bidirectional (read/write) Monday sync in v1:** larger surface, conflict/echo handling, and risk
  of corrupting CRM master data before the projection is trusted — deferred to a future ADR.
- **Continue with CSV import as the primary path:** does not reflect where AXIS actually maintains
  CRM data; makes data continuously stale — rejected (CSV retained only as optional fallback).
- **Master taxonomy locally with manual CRUD:** duplicates Monday's vocabularies and drifts —
  rejected in favor of mirror + normalization.

## Consequences

- **No customer/campaign code or Prisma schema existed at decision time**, so adoption cost is
  documentation-only; the first schema will be authored directly against this model.
- The persistence stack (ADR-0002: PostgreSQL + Prisma + migrations, integrity, transactions,
  idempotent upsert) is **unchanged and still correct** — now applied to sync instead of import.
- The integration-port pattern (ADR-0004) **extends cleanly**: Monday is a new `CrmSource` port/adapter
  in `server/integrations`, symmetric to `EmailProvider` / `ContentSource`.
- ADR-0006 is **amended**: its origin narrative (“imported from Hashavshevet via Excel/CSV”) and its
  `sourceSystem + externalId` / email-merge dedupe reasoning are **superseded**; its **nullable /
  incomplete-data model and derived email eligibility remain valid** (Monday items also have empty
  columns).
- New sync entities are introduced conceptually now (documented), created at the sync milestone:
  `MondayBoard`, `SyncRun`, `SyncItemLog`, `MondayWebhookEvent`, plus projection/provenance fields
  on `Company`/`Contact`.
- **Open decisions** (tracked in `docs/requirements.md` §11): board topology and company↔contact link
  representation; whether a reliable Monday `language`/`consent` field exists to mirror; deletion vs
  archival edge cases; whether/when to add Monday write-back; retention/removal of the CSV fallback.
- No queue/Redis is required (ADR-0005 stands): sync volume at ~500–2,000 records is light.
