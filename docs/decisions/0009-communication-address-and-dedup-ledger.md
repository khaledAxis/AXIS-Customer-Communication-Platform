# ADR-0009: CommunicationAddress, deduplicated delivery ledger & test-send isolation

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** refines ADR-0006 (contact data model), ADR-0007 (Monday projection), ADR-0008 (safe-send); authoritative for the data foundation implemented in Milestone 1.

## Context

The real Monday CRM inspection proved: the same **normalized email** appears on many CRM records
(60 within-customers, 93 within-contacts, **158 cross-board** overlaps); `Company↔Contact` is
**many-to-many** (1 company → up to 22 contacts; 14 contacts link to >1 company; 34 orphans; 47% of
companies have no contact); **Industry** is a Company status mirrored to contacts; **Products** are
two Connect-Boards (catalogue `1903021552` + owned instances `1903021951`); and Monday has **no**
Brand, Tag, Language, or Consent fields. Earlier docs modeled a per-contact `companyId`, per-contact
communication fields, a `(campaignId, contactId)` ledger, and Monday-mirrored Brand/Tag — all now
incorrect.

## Decision

1. **`CommunicationAddress` is the email-centric local communication profile.** One row per
   `normalizedEmail` (globally unique). It **owns** `emailStatus`, `language`, `consentStatus`
   (LOCAL_OWNED, `UNKNOWN` default, never inferred). CRM sync **never** writes these. The same
   normalized email on N CRM records resolves to **one** profile. When a Monday email changes, the old
   `CommunicationAddress` (and its unsubscribe/suppression history) is left intact; the new normalized
   address gets/links its own profile.
2. **`Company`/`Contact` keep raw Monday emails** (`companyEmail`, `accountingEmail`, `email`) plus a
   derived `*Norm` lookup field. They **no longer** hold `emailStatus`/`language`/`consentStatus`.
   `accountingEmail` is **never** a campaign candidate.
3. **`Company↔Contact` is many-to-many via `CompanyContact`** (`@@unique([companyId, contactId])`).
   No mandatory `companyId` on `Contact`. Supports zero/many/orphan/multi.
4. **Industry belongs to `Company`** (reference table from status labels); `Contact` has **no** own
   industry FK. `CustomerClassification` is a separate reference; `Category` is a mirrored **free-text
   string**. **Brand/Tag are omitted from v1** (absent in Monday).
5. **Deduplicated delivery ledger:** `CampaignRecipient` is keyed on **`@@unique([campaignId,
   normalizedEmail])`** — at most one production delivery per campaign+email. `CampaignRecipientSource`
   preserves every contributing CRM record with a **non-null immutable identity**
   `@@unique([recipientId, sourceBoardId, sourceItemId, emailSourceType])`; local Company/Contact FKs
   are navigation-only (`SetNull`).
6. **Audience resolution is not delivery.** Pre-recipient exclusions (no/invalid email, unsubscribed,
   suppressed, consent DENIED, archived, language-unknown, company-inactive) are recorded in
   **`CampaignAudienceExclusion`** with a **`CampaignAudienceSnapshot`** funnel summary
   (incl. `duplicateSourcesCollapsed`). **No fake/skipped `CampaignRecipient` rows.** A duplicate
   source that collapses into an existing destination is **retained as a source**, not an exclusion.
7. **Test sends are isolated in `CampaignTestSend`.** Resolving N intended recipients sends **zero**
   emails. One explicit test-send action = one message, `fahed@axis-gps.com → khaled-s@axis-gps.com`.
   Production `CampaignRecipient` state is never changed by a test. (Actual delivery + Microsoft Graph
   are not implemented yet.)
8. **Unsubscribe/Suppression = effective state** keyed by `normalizedEmail` (immutable snapshot),
   idempotent, sync-immune; `Suppression` is fed by immutable `SuppressionEvent` rows. GLOBAL scope
   for v1; public no-login token deferred (schema-ready).
9. **Historical protection is structural.** Campaigns are never hard-deleted once they have history;
   `Campaign → CampaignRecipient/CampaignEvent/CampaignTestSend` use **`Restrict`**; only re-derivable
   audience-preview data (`CampaignAudienceSnapshot/Exclusion`) may `Cascade`. CRM records are
   **archived** locally, never hard-deleted.
10. **Sending safety:** a DB-level `PENDING→READY→SENDING→SENT/FAILED` claim state machine (with
    `attemptCount`, `claimedAt`, `providerMessageId`, `failureReason`) is the **primary** duplicate-send
    guard — no reliance on a provider idempotency key. `SEND_MODE=TEST` is the default.
11. **Eligibility is always derived** (no stored `eligible` boolean), resolving through the
    `CommunicationAddress` for the candidate email plus unsubscribe/suppression/CRM-state gates.

## Alternatives Considered

- Per-CRM-entity communication state (prior design): breaks under duplicate emails — a person on 7
  records would have 7 divergent consent/unsubscribe states. Rejected.
- `(campaignId, contactId)` ledger: cannot prevent duplicate delivery when an email spans records/
  boards; company emails have no contact. Rejected.
- Skipped-recipient rows for exclusions: pollutes the ledger and risks accidental "SENT". Rejected in
  favor of snapshot + exclusion tables.
- Provider idempotency key as primary guard: not guaranteed by the (unchosen) provider. Rejected; DB
  is authoritative.

## Consequences

- One coherent communication profile per email; unsubscribe/consent survive CRM churn and email
  changes. Duplicate-send is structurally impossible per campaign+email while all sources stay
  auditable.
- Eligibility logic lives in `domain/` (pure, unit-tested) over the communication model.
- Documentation updated in the same change (CLAUDE.md, requirements.md, architecture.md,
  development-plan.md); ADR-0006/0007 carry amendment pointers here.
- **Open (business):** legal treatment of `UNKNOWN` consent for company emails; whether AXIS adds
  Monday language/consent fields; retention of the optional `CompanyProduct` direct association.
