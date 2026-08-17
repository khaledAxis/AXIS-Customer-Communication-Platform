# ADR-0010: Recurring newsletter automation, multi-content composition & reviewed external content

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** extends ADR-0008 (safe-send), ADR-0009 (dedup ledger, CommunicationAddress). CRM/ADR-0007 unchanged except added back-relations.

## Context

AXIS needs a recurring newsletter platform, not only a manual campaign tool. Newsletters bundle
several pieces (an AXIS article, a Trimble/NavVis/Spectra article, a product/training announcement, a
promotion). Some content is written internally; some is discovered from approved external sources.
The workflow is: approved sources → automatic collection → **Content Inbox** → human review → user
selects & orders content → newsletter draft → audience preview → TEST send → approval → scheduled
weekly/monthly send → production delivery → reporting. The UI must be non-technical/UI-first. This ADR
finalizes the data/domain foundation **before the first migration**; no network fetching, provider, or
UI is implemented.

## Decision

1. **Multi-content composition.** A campaign composes **many ordered** content items via
   **`CampaignContentItem`** (`position`, `isIncluded`, optional `customHeading`/`customIntro`,
   per-item frozen snapshot). `@@unique([campaignId, contentItemId])` prevents accidental duplicate
   inclusion. The single `Campaign.contentItemId` is removed.
2. **Snapshots are authoritative history.** Each `CampaignContentItem` freezes its selected content at
   approval/send, and the **campaign-level** `snapshot*` fields freeze the final rendered newsletter.
   Editing the source `ContentItem` later never alters sent history (`CampaignContentItem.contentItem`
   is `onDelete: Restrict`).
3. **Internal + external content.** `ContentItem` gains `origin` (`INTERNAL | INGESTED`),
   `summary`, `sourceId`, `sourceName`, `author`, `externalId`, `externalUrl`, `publishedAt`,
   `ingestedAt`; `bodyHtml` is now **optional** (external items may be link+title+summary). Language
   defaults to **`UNKNOWN`** (valid during ingestion; never inferred; human review can correct).
4. **Approved sources.** **`ContentSource`** (`kind`: `INTERNAL | RSS | WEBSITE | API |
   MANUAL_EXTERNAL`, `baseUrl`, `isEnabled`). External source URLs are configuration/data, not secrets.
5. **External review is mandatory.** Automatic **collection ≠ automatic sending.** Ingested items are
   created **`PENDING_REVIEW`** (states `NEW | PENDING_REVIEW | APPROVED | REJECTED`) and are **not
   production-usable until `APPROVED`**. The user decides what is included.
6. **External dedup / ingestion history.** `ContentItem @@unique([sourceId, externalId])` makes
   re-ingestion idempotent where an external id exists (fallback: canonical URL — no content-similarity
   matching in v1). **`ContentIngestionRun`** records source runs (counts/status). No fetching is
   implemented.
7. **Recurring automation (ASSISTED).** **`NewsletterAutomation`** (`cadence` WEEKLY|MONTHLY,
   `interval`, `dayOfWeek`/`dayOfMonth`/`weekOfMonth`, `timezone`, `language`, `segmentId`,
   `nextScheduledAt`). Default `mode = ASSISTED`: on schedule it **prepares a DRAFT** campaign; a human
   reviews content, selects/orders it, previews the audience, TEST-sends, and **approves**. Automation
   **never** auto-selects external articles nor auto-sends. No RRULE is exposed to users.
8. **Automation idempotency.** **`NewsletterAutomationRun`** with `@@unique([automationId,
   scheduledFor])` guarantees **one occurrence → at most one generated campaign**
   (`generatedCampaignId @unique`). No background scheduler is implemented.
9. **Scheduled production sending is gated.** A scheduled/automation campaign is sendable only if:
   content selected + external content approved + **four-eyes approved** + scheduled time reached +
   **production mode explicitly enabled** + recipient eligibility re-evaluated + unsubscribe/
   suppression pass. **If the time arrives unapproved → DO NOT SEND** (remains attention-required).
10. **Existing safeguards unchanged.** TEST/SAFE-SEND default (`fahed@axis-gps.com` →
    `khaled-s@axis-gps.com`, one explicit message), audience preview sends **zero** messages,
    `CommunicationAddress`, global unsubscribe, suppression, `(campaignId, normalizedEmail)` dedup,
    `CampaignRecipientSource` auditability, historical `Restrict` protection — all preserved.
    Recurring campaigns **re-evaluate eligibility at send time**.

## Alternatives Considered

- **Single ContentItem per campaign (status quo):** cannot express a multi-article newsletter.
- **Autonomous automation that auto-selects & sends:** unacceptable — external articles could reach
  customers without review. Rejected; ASSISTED is the default and only v1 mode.
- **Content-similarity dedup for external articles:** risky/over-engineered for v1; use
  `sourceId+externalId` / canonical URL only.
- **RRULE stored and shown to users:** not UI-friendly; use simple cadence fields (structured
  `recurrence` JSON reserved for internal future use).

## Consequences

- Editorial control stays with humans; approval and production safety are unchanged and enforced.
- Sent newsletters are historically reproducible at both item and campaign level.
- New models: `CampaignContentItem`, `ContentSource`, `ContentIngestionRun`, `NewsletterAutomation`,
  `NewsletterAutomationRun`; `ContentItem` extended; `Campaign` single-content relation replaced.
- Pure domain added: content readiness, snapshot freeze, recurrence validation + occurrence key,
  scheduled-send eligibility, automation draft factory — all unit-tested; no jobs/providers/network.
- **Open (business):** exact cadence options to expose; default timezone; per-source trust config;
  whether a shared article translated HE/AR is one item per language (current model allows either).
