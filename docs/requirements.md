# Requirements — AXIS Customer Communication Platform

Status: **Draft for MVP foundation.** This document defines *what* the system must do. It is the
source of truth for scope; when scope changes, update it here and, if the change is architectural,
add an ADR.

---

## 1. Project Goals

1. Mirror AXIS customer contact data from **Monday.com** (the CRM source of truth) into one place for
   communication, segmentation, campaign building, and reporting.
2. Let staff organize contacts by **industry, product interests, brand interests, and tags**, and
   build **segments** from those attributes.
3. Compose **newsletters/campaigns** in **Hebrew and Arabic** (RTL), from internal content and,
   later, from externally ingested-then-reviewed content.
4. Enforce a **manager approval workflow** before anything is sent.
5. Send via an external email provider **safely** — never mass-mailing the wrong people, never
   emailing unsubscribed/suppressed/invalid recipients.
6. Track delivery, opens, clicks, bounces, and unsubscribes.
7. Tolerate **incomplete data**: import what exists, surface gaps, enable later enrichment.

## 2. Users & Roles

| Role | Who | Can do |
| --- | --- | --- |
| **ADMIN** | Administrator / developer | Everything: manage users, import, build, approve, send, configure. May approve own campaigns (setup/emergency). |
| **MANAGER** | Company managers | Review and **approve/reject** campaigns; build and manage campaigns/content/contacts. **Cannot approve a campaign they created** (four-eyes). |

Additional roles (e.g. `EDITOR`, `VIEWER`) are **out of MVP scope** but the role model must allow
adding them without redesign.

## 3. Functional Requirements

Grouped by module. **[MVP]** = in scope for first version; **[Future]** = deferred.

### 3.1 Authentication & Authorization
- **[MVP]** Email/password login (Auth.js credentials), session management, logout.
- **[MVP]** Role-based authorization enforced **server-side**.
- **[Future]** SSO / OAuth, password reset by email, MFA.

### 3.2 Users & Roles
- **[MVP]** Admin can create users and assign a role. Seed an initial admin.
- **[Future]** Self-service invites, granular per-module permissions.

### 3.3 Companies
- **[MVP]** CRUD companies with **mostly optional** metadata (name required; industry, size, notes,
  external reference optional). A company groups contacts.
- **[MVP]** Companies support **partial data**.

### 3.4 Contacts
- **[MVP]** CRUD contacts. **Almost all fields optional** (see §7). A contact may belong to a company.
- **[MVP]** Explicit **email eligibility** and **communication status** (see §8, Business Rules).
- **[MVP]** Visible indicators for incomplete profiles.

### 3.5 Monday CRM Synchronization (primary ingestion)
- **[MVP]** Sync companies/contacts from **Monday.com** (source of truth) via the Monday GraphQL API
  + verified webhooks, with a scheduled reconciliation backstop. Map Monday columns to fields;
  **idempotent upsert** keyed on `(mondayBoardId, mondayItemId)` inside a transaction.
- **[MVP]** Classify each synced item for data quality (§8.4); preserve the raw Monday item snapshot
  (`rawItem`) and a **`SyncRun` / `SyncItemLog`** audit trail.
- **[MVP]** Never skip a record solely for missing optional metadata; flag invalid emails; **archive
  on Monday deletion** (never hard-delete records with campaign history); track `lastSyncedAt`.
- **[MVP]** **Read-only toward Monday** — no write-back in v1 (ADR-0007).
- **[MVP, secondary/optional]** A CSV/Excel **admin/developer fallback** (bootstrap/backfill) reusing
  the same classification + idempotent-upsert rules. **Not** a normal user workflow.
- **[Future]** Bidirectional Monday sync (write-back); additional CRM sources.

### 3.6 Taxonomy — Industry, Customer Classification, Category, Products
Corrected to the **real Monday CRM** (ADR-0009):
- **[MVP]** **Industry** (`תחום עיסוק`) is a Company-level Monday **status**, mirrored to a local
  `Industry` reference table; it **belongs to Company** — contacts inherit it by traversing their
  company, with **no** independent contact industry.
- **[MVP]** **Customer Classification** (`מיון לקוח`) is a separate Company status → local reference
  table (kept distinct from Industry).
- **[MVP]** **Category** (`קטגוריה`) is **free text** in Monday → mirrored as a **string** (no invented
  taxonomy).
- **[MVP]** **Products** are two Connect Boards → `Product` (catalogue, `1903021552`) and
  `CustomerProduct` (owned/installed/subscription, `1903021951`).
- **[Not in v1]** **Brand** and **Tag**: **no such fields exist in Monday** — omitted from v1 (no
  Monday-mirrored Brand/Tag models). Local tags remain a possible future enhancement only.
- No separate local taxonomy-master CRUD in v1; taxonomy values are enriched in Monday.

### 3.7 Segmentation
- **[MVP]** Build segments by combining industry / product interests / brand interests / tags
  (AND/OR filters). Preview the resolved contact set and how many are **eligible** vs excluded.
- **[Future]** Saved dynamic segments that re-resolve automatically; behavioral segments (engagement).

### 3.8 Content Library & multi-content newsletters (ADR-0010)
- **[MVP]** Create/store reusable `ContentItem`s (title, summary, optional body/HTML, media/link,
  language). External items may be **link + title + summary** only.
- **[MVP]** Distinguish **INTERNAL** (staff-authored) from **INGESTED** (external) content via
  `origin`; ingested content is **PENDING_REVIEW** until approved.
- **[MVP]** A newsletter/campaign composes **multiple ordered** content items (`CampaignContentItem`
  with position/include flags); the same item cannot be added twice. Users select, deselect, reorder,
  preview, and save drafts (drag/drop or Move Up/Down in a later UI).
- **[MVP]** Content is **snapshotted** at approval/send (per-item + campaign-level) so sent
  newsletters stay reproducible even if the source item is later edited.
- **[Future]** Versioning, rich templates, AI summarization of ingested items (ADR §3.20).

### 3.9 Multilingual Content (Hebrew & Arabic)
- **[MVP]** Content and campaigns carry an explicit language; UI renders **RTL** correctly for both.
- **[MVP]** Language is `HE | AR | UNKNOWN`; `UNKNOWN` is explicit, never silently Hebrew. Contact
  language is **mirrored from Monday** if a reliable field exists, otherwise locally managed (ADR-0007).
- **[Future]** Per-contact language preference learning; automatic translation.

### 3.10 Campaign / Newsletter Builder
- **[MVP]** Create a campaign: subject, language, target segment, content composition, sender.
- **[MVP]** Server-side lifecycle/state machine (§8.1). Content editable only in `DRAFT`.
- **[Future]** Drag-and-drop block editor, reusable layouts, A/B testing.

### 3.11 Email Preview
- **[MVP]** Render an accurate HTML preview of the campaign in its language/RTL, incl. a sample
  contact's merge fields.

### 3.12 Send Modes — TEST / SAFE-SEND vs PRODUCTION
- **[MVP]** The system runs in **`TEST` / SAFE-SEND mode by default**; real customer sending is
  disabled by default. In `TEST` mode **no email reaches a real CRM address** — all deliveries are
  redirected server-side to the configured safe-send address (default `khaled-s@axis-gps.com`), while
  the intended recipient is retained in preview/logging so segmentation/personalization can be
  verified (§8.8).
- **[MVP]** Switching to **`PRODUCTION`** mode is an **explicit administrative action**, never
  automatic (not on tests passing, not on approval). Enforced server-side; the UI always shows the
  active mode (ADR-0008).

### 3.13 Manager Approval Workflow
- **[MVP]** Submit for approval → manager approves or rejects (reason required). Four-eyes enforced
  server-side. Audit every decision.

### 3.14 Campaign Scheduling
- **[MVP]** Schedule an approved campaign for a future time (`sendAt`), or send immediately after
  approval with confirmation. A due scheduled campaign transitions to sending.
- **[MVP, minimal]** A simple in-process/`cron`-style trigger checks for due campaigns (no external
  queue yet — see ADR-0005).

### 3.15 Recurring Newsletter Automations (ADR-0010)
- **[MVP]** Configure recurring **WEEKLY/MONTHLY** newsletter automations (`NewsletterAutomation`:
  cadence, interval, day-of-week/day-of-month, timezone, language, segment) through a simple UI (no
  RRULE exposed).
- **[MVP]** Automation is **ASSISTED**: on schedule it **prepares a DRAFT** campaign for human review;
  it **never** auto-selects external articles and **never** auto-sends. One occurrence produces **at
  most one** campaign (`NewsletterAutomationRun` unique per `(automationId, scheduledFor)` —
  idempotent). Background scheduler execution is a later milestone.
- **[MVP]** A scheduled campaign is sendable only when approved (four-eyes) + content ready + external
  content approved + time reached + **production explicitly enabled** + eligibility re-evaluated. If
  unapproved at the scheduled time, it is **not** sent.

### 3.16 Email Provider Integration
- **[MVP]** Send through an **external transactional/bulk provider via HTTP API**, behind an internal
  `EmailProvider` interface (ADR-0004). No direct Gmail/Outlook SMTP. Vendor SDK added only at this
  milestone.

### 3.17 Delivery / Open / Click / Bounce / Unsubscribe Analytics
- **[MVP]** Ingest provider webhooks (delivered, open, click, bounce, complaint, unsubscribe) into a
  per-send event log; show basic per-campaign metrics.
- **[Future]** Cross-campaign dashboards, engagement scoring.

### 3.18 Unsubscribe / Suppression Management
- **[MVP]** Every customer-facing newsletter includes a **functional, public, no-login** unsubscribe
  link. On unsubscribe: persist a record, make the recipient **immediately ineligible**, and preserve
  history for audit. Maintain a **suppression list** (hard bounce, complaint, manual).
- **[MVP]** Unsubscribe/suppression are **locally owned and sync-immune** — a Monday CRM sync must
  never overwrite or remove them. Suppressed/unsubscribed contacts are **never** included in a send
  (§8.9, ADR-0008).

### 3.19 External Content Ingestion & Content Inbox (ADR-0010)
- **[MVP]** Model approved **`ContentSource`s** (INTERNAL/RSS/WEBSITE/API/MANUAL_EXTERNAL) and store
  ingested items as **PENDING_REVIEW** content; record `ContentIngestionRun` history. **Automatic
  collection ≠ automatic sending** — external content is never customer-sent without human approval.
- **[MVP]** External ingestion is **idempotent** by `(sourceId, externalId)` (fallback: canonical
  URL); no content-similarity matching in v1.
- **[Future/UI]** A friendly **Content Inbox** lists collected items (source, title, date, language,
  review status) with Preview / Approve / Ignore / Add-to-Newsletter actions.
- **[Future]** Automated network collectors (RSS/API/website) — **not** implemented yet (no fetching).

### 3.20 AI-Assisted Content Summarization
- **[Future]** Summarize/normalize ingested articles with an LLM (Claude), human-reviewed before use.
  Explicitly a later phase; do not build now.

### 3.21 Audit / History
- **[MVP]** Audit trail for campaign lifecycle actions (submit, approve, reject, schedule, send,
  cancel), imports, and suppression changes: who, what, when, from→to, reason.

## 4. Non-Functional Requirements

- **Correctness & safety first** — especially around sending, approvals, and consent.
- **Maintainability** — clear layering, strong typing, minimal dependencies, documented decisions.
- **Data integrity** — enforced in the database (constraints, FKs, uniqueness), not only in app code.
- **Security** — no committed secrets, server-enforced authz, validated inputs, signed webhooks.
- **Internationalization** — full **RTL** support for Hebrew and Arabic from the start.
- **Accessibility & responsiveness** — semantic, keyboard-navigable, responsive UI.
- **Scale** — small (~500–2,000 contacts, low campaign volume). Do **not** over-engineer for scale;
  choose simple designs. Revisit only with evidence.
- **Observability** — meaningful logs for auth, approvals, sends, imports, webhook processing.
- **Idempotency** — CRM sync, scheduling, and sending must be safe to retry without duplication.
- **CRM projection integrity** — Monday is the source of truth; the platform is a read-only projection
  in v1 and must never overwrite locally-owned communication state during sync.
- **Sync freshness visibility** — `lastSyncedAt` is tracked; stale data warns (does not auto-block) in v1.
- **Send safety by default** — `TEST`/SAFE-SEND mode is the default and enforced server-side; going to
  production is an explicit action.

## 5. MVP Scope (in)

Auth + roles; users; **companies/contacts mirrored from Monday.com (source of truth)** via an
**idempotent, classified CRM sync** (CSV import only as an optional admin fallback); brands /
products / industries / tags **mirrored** from Monday; segmentation; content library with HE/AR +
RTL; campaign builder with **server-side lifecycle**; email preview; **`TEST`/SAFE-SEND mode with an
explicit `PRODUCTION` toggle**; **manager approval (four-eyes)**; scheduling (minimal trigger);
**email provider via API behind an interface**; delivery/engagement event capture; **public
unsubscribe + suppression (locally owned, sync-immune)**; audit trail for lifecycle actions.

## 6. Out of Scope (MVP)

- Public SaaS / multi-tenancy / customer self-service portals.
- **Direct Hashavshevet integration** — Hashavshevet is upstream of Monday and is **not** modeled as a
  source for this platform (ADR-0007).
- **Write-back to Monday** (bidirectional sync) — v1 is read-only toward Monday.
- Automated external content **collectors** and **AI summarization** (boundary defined; feature later).
- Recurring/triggered automations, drag-and-drop editor, A/B testing, advanced analytics dashboards.
- SSO/MFA, granular permission matrices beyond ADMIN/MANAGER.
- Redis/BullMQ/worker fleet (added only when scheduling/sending proves the need — ADR-0005).

## 7. Data Completeness Requirements (imported / incomplete data)

CRM data mirrored from Monday.com is frequently incomplete (empty columns). The model and sync flow
**must** handle this.

**Fields that may be missing** (and therefore **nullable** at the DB layer): contact first name, last
name, phone, email, industry, product interests, brand interests, language, job title, company
metadata.

**Rules:**
1. Company and contact records **must support partial/incomplete data**.
2. Optional business metadata must **not** be `NOT NULL` without a strong integrity reason.
3. Missing segmentation data must **not** prevent importing the customer.
4. Contacts **without email may exist** but are **not eligible** for email campaigns.
5. **Email eligibility is explicit**, never inferred from mere contact existence (§8.2).
6. **Invalid emails are flagged** during sync (`emailStatus = INVALID`) and **excluded from sending**.
7. **Missing language = `UNKNOWN`** (explicit), never silently Hebrew.
8. Missing industry/product/brand info is shown as **incomplete data**, enrichable later.
9. The sync (and optional-fallback preview) **distinguishes** the categories in §8.4.
10. **Do not discard a whole row** just because optional metadata is missing.
11. **Preserve the raw Monday item snapshot** (`rawItem` + `SyncItemLog`) for troubleshooting/audit.
12. The UI must make **incomplete profiles easy to identify and enrich**.

> **Required-fields reconciliation (decision — ADR-0006, origin/dedupe amended by ADR-0007):** The
> brief also states `email: required`, `language: required`, `industry: required`. We interpret this
> as a **completeness/eligibility** requirement, **not** a persistence constraint:
> - **Persistence:** `email`, `language`, `industry` are **nullable** — incomplete data always mirrors in.
> - **Eligibility/completeness:** to be a valid target of a **localized, industry-segmented email
>   campaign**, a contact needs a **valid email** (sendable), a **known language** (renderable), and a
>   **known industry** (segmentable). Contacts missing any are **mirrored and stored**, marked
>   *incomplete*, and excluded from the relevant sends until enriched **in Monday**.
>
> This must be confirmed with the business (see Open Questions).

## 8. Business Rules

### 8.1 Campaign lifecycle (states & transitions)

States: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SCHEDULED`, `SENDING`, `SENT`,
`CANCELED`, `FAILED`.

Allowed transitions (enforced by a domain state machine, server-side):

| From | Action | To | Guard |
| --- | --- | --- | --- |
| DRAFT | submit | PENDING_APPROVAL | has content + target segment |
| PENDING_APPROVAL | approve | APPROVED | actor is MANAGER/ADMIN **and** not the creator (unless ADMIN) |
| PENDING_APPROVAL | reject | REJECTED | reason required |
| REJECTED | edit | DRAFT | — |
| APPROVED | schedule | SCHEDULED | `sendAt` in the future |
| APPROVED | send now | SENDING | typed confirmation + recipient count |
| SCHEDULED | trigger (due) | SENDING | `now ≥ sendAt` |
| SCHEDULED / APPROVED | cancel | CANCELED | — |
| SENDING | complete | SENT | dispatch finished |
| SENDING | fail | FAILED | unrecoverable error |

`SENT`, `CANCELED`, `FAILED` are terminal. Content is editable **only** in `DRAFT`. Every transition
is audited. (Names may evolve; changes documented in ADR-0006 / architecture.)

### 8.2 Contact communication eligibility

A contact is **email-eligible** (a valid send target) iff **all**: `status = ACTIVE` **and**
`emailStatus = VALID` (a valid email present) **and** **not unsubscribed** **and** **not suppressed**
**and** `consentStatus ≠ DENIED`. Eligibility is **derived** and **re-evaluated at send time**.
Unsubscribe and suppression are **locally owned** and **never** overwritten by CRM sync (§8.9).

### 8.3 Sending safety

`TEST`/SAFE-SEND mode is the default and enforced server-side (§8.8); recipients recomputed live at
send; **idempotent** per (campaign, contact) via a unique send-ledger row; typed confirmation with
recipient count; environment guard prevents non-prod from mailing real contacts. Going to
`PRODUCTION` is an explicit administrative action, never automatic.

### 8.4 Sync-item data-quality classification

Every synced Monday item (and every optional-fallback CSV row) is classified as exactly one of:

| Class | Meaning | Mirrored? | Sendable? |
| --- | --- | --- | --- |
| `SENDABLE` | Valid + complete + valid email + eligible | Yes | Yes |
| `INCOMPLETE` | Mirrored but missing language/industry/segmentation | Yes | Not for localized/segmented sends until enriched in Monday |
| `NO_EMAIL` | No email present | Yes | No (not email-eligible) |
| `INVALID_EMAIL` | Email present but invalid | Yes (flagged `INVALID`) | No |
| `CONFLICT` | Ambiguous/duplicate identity (e.g. same email on different Monday items) | Yes, both kept | Reported for resolution **in Monday** (Monday owns merges); not merged locally |
| `ERROR` | Cannot mirror (missing composite identity / unparseable) | No | No |

Identity is the composite `(mondayBoardId, mondayItemId)`; email is a validated attribute, not the
identity key.

### 8.5 Segmentation vs eligibility

Resolve the segment first, then apply the eligibility filter. Excluded-but-in-segment contacts are
**counted and visible**, never silently dropped.

### 8.6 Language

`HE | AR | UNKNOWN`. Localized sends exclude `UNKNOWN`-language contacts unless an admin explicitly
overrides per campaign. All content renders RTL for HE and AR.

### 8.7 CRM sync & ownership (Monday is the source of truth)

Monday.com is the source of truth; the platform is a read-only projection (ADR-0007). Sync mirrors
Monday-owned fields (identity, names, company link, phone, job title, email, industry, interests,
tags, language-if-available) and **must never overwrite locally-owned** state (`emailStatus`,
`consentStatus`-if-not-mapped, unsubscribe, suppression, campaigns, events, audit, segments). Identity
is `(mondayBoardId, mondayItemId)`. Monday deletion **archives** the projection (never hard-delete
with campaign history). `lastSyncedAt` tracks freshness; stale data **warns** (v1), it does not block.

### 8.8 Send modes (TEST / SAFE-SEND vs PRODUCTION)

`TEST`/SAFE-SEND is the default; production sending is disabled by default. In `TEST` mode **no email
reaches a real CRM address** — every delivery is redirected server-side to `SAFE_SEND_REDIRECT_TO`
(default `khaled-s@axis-gps.com`), while the intended recipient is retained in preview/logging for
verification. Switching to `PRODUCTION` is an **explicit, audited administrative action** — never
automatic. Enforced **server-side**; the UI always shows the active mode (ADR-0008).

### 8.9 Unsubscribe & consent

Every newsletter includes a **public, no-login, tokenized** unsubscribe link. Unsubscribing persists
a record, makes the address **immediately ineligible**, preserves history, and is **sync-immune** (a
Monday sync never removes it). Suppression (hard bounce/complaint/manual) is likewise locally owned.

### 8.10 CommunicationAddress & deduplicated delivery (authoritative — ADR-0009)

- Local communication state is **email-centric**: one **`CommunicationAddress`** per `normalizedEmail`
  owns `emailStatus`, `language`, `consentStatus` (all `UNKNOWN`-default, never inferred, never
  overwritten by sync). The same email on many CRM records → **one** profile.
- **Company email** is a valid campaign candidate (many companies have no contact); **accounting
  email is never** a candidate. The legal treatment of `UNKNOWN` consent for company emails is an open
  business decision (§11).
- **Deduplicated delivery:** `CampaignRecipient` is unique on **`(campaignId, normalizedEmail)`** — at
  most one production delivery per campaign+email; `CampaignRecipientSource` preserves every
  contributing CRM record `(mondayBoardId, mondayItemId, entityType, emailSourceType)`.
- **Audience resolution ≠ delivery:** exclusions are counted in `CampaignAudienceSnapshot` and detailed
  in `CampaignAudienceExclusion` (no fake recipient rows); duplicate sources collapsing into one
  destination are **retained**, counted as `duplicateSourcesCollapsed` (not exclusions).
- **TEST mode never fans out:** resolving N intended recipients sends **zero** emails; test sends are
  isolated in `CampaignTestSend` (`fahed@axis-gps.com → khaled-s@axis-gps.com`, one per explicit
  action) and never change production recipient state.
- Eligibility is **always derived** (no stored `eligible` flag).

## 9. Languages

Hebrew and Arabic for content and recipient-facing material (both RTL). The **admin UI** language is
English for MVP (internal tool); UI i18n is a possible future enhancement. Content language is
tracked explicitly per content item and campaign.

## 10. Scale Assumptions

- ~500–2,000 contacts initially; low concurrent users (admin + a few managers); modest campaign
  frequency. Designs should favor simplicity; premature scaling infrastructure is out of scope.

## 11. Open Questions (need business/technical validation)

1. **Required-fields semantics** (§7 / ADR-0006, amended by ADR-0007): confirm `email`/`language`/
   `industry` are *nullable in storage but required for eligibility/completeness*, not hard `NOT NULL`.
2. **Email provider choice** (Resend / Postmark / Amazon SES / other) — affects webhook format and
   deliverability setup (SPF/DKIM/DMARC for AXIS domain).
3. **Monday board topology:** which boards hold accounts vs contacts, and how is the company↔contact
   link modeled (connected-boards column vs a text column)?
4. **Monday field mapping:** is there a reliable Monday **language** field and a reliable **consent**
   field to mirror, or do these stay locally managed?
5. **Consent/legal basis:** what opt-in status do CRM records carry, and what unsubscribe wording is
   required (HE/AR)?
6. **CSV fallback:** retain the optional admin/developer CSV bootstrap, or Monday-only from day one?
7. **Monday write-back:** whether/when the platform should push unsubscribe/suppression back to Monday
   (deferred; currently read-only).
8. **Admin UI language:** English only for MVP, or Hebrew/Arabic admin UI too?
9. **Sender identities/domains:** which from-addresses/domains will AXIS send from?
