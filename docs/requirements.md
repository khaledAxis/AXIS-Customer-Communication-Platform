# Requirements — AXIS Customer Communication Platform

Status: **Draft for MVP foundation.** This document defines *what* the system must do. It is the
source of truth for scope; when scope changes, update it here and, if the change is architectural,
add an ADR.

---

## 1. Project Goals

1. Centralize AXIS customer contact data (imported from Hashavshevet via Excel/CSV) in one place.
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

### 3.5 CSV/Excel Import
- **[MVP]** Upload Excel/CSV exported from Hashavshevet; map columns; **preview** with per-row
  classification (§8.4); **commit** idempotently inside a transaction.
- **[MVP]** Preserve raw source rows and an import batch record for audit/troubleshooting.
- **[MVP]** Never discard a row solely for missing optional metadata; flag invalid emails.
- **[Future]** Direct Hashavshevet API/DB integration; scheduled auto-import.

### 3.6 Taxonomy — Brands, Products, Industries, Tags
- **[MVP]** CRUD for **Brands**, **Products**, **Industries**, **Tags**. Associate them with
  contacts/companies (interests). All associations optional.
- **[MVP]** `Industry` is a controlled list (enrichable), referenced by contacts for segmentation.

### 3.7 Segmentation
- **[MVP]** Build segments by combining industry / product interests / brand interests / tags
  (AND/OR filters). Preview the resolved contact set and how many are **eligible** vs excluded.
- **[Future]** Saved dynamic segments that re-resolve automatically; behavioral segments (engagement).

### 3.8 Content Library
- **[MVP]** Create/store reusable content items (title, body, media refs) with **language** (HE/AR).
- **[MVP]** Distinguish **internal/manual** content from **ingested** content pending review.
- **[Future]** Versioning, rich templates, approval of content items themselves.

### 3.9 Multilingual Content (Hebrew & Arabic)
- **[MVP]** Content and campaigns carry an explicit language; UI renders **RTL** correctly for both.
- **[MVP]** Language is `HE | AR | UNKNOWN`; `UNKNOWN` is explicit, never silently Hebrew.
- **[Future]** Per-contact language preference learning; automatic translation.

### 3.10 Campaign / Newsletter Builder
- **[MVP]** Create a campaign: subject, language, target segment, content composition, sender.
- **[MVP]** Server-side lifecycle/state machine (§8.1). Content editable only in `DRAFT`.
- **[Future]** Drag-and-drop block editor, reusable layouts, A/B testing.

### 3.11 Email Preview
- **[MVP]** Render an accurate HTML preview of the campaign in its language/RTL, incl. a sample
  contact's merge fields.

### 3.12 Test Email Sending
- **[MVP]** Send a **test** to explicit test addresses only. Cannot reach the real segment. Distinct
  code path from a real send.

### 3.13 Manager Approval Workflow
- **[MVP]** Submit for approval → manager approves or rejects (reason required). Four-eyes enforced
  server-side. Audit every decision.

### 3.14 Campaign Scheduling
- **[MVP]** Schedule an approved campaign for a future time (`sendAt`), or send immediately after
  approval with confirmation. A due scheduled campaign transitions to sending.
- **[MVP, minimal]** A simple in-process/`cron`-style trigger checks for due campaigns (no external
  queue yet — see ADR-0005).

### 3.15 Recurring Automations
- **[Future]** Recurring/triggered campaigns (e.g. monthly newsletter). Not in MVP; the schema
  should not preclude it.

### 3.16 Email Provider Integration
- **[MVP]** Send through an **external transactional/bulk provider via HTTP API**, behind an internal
  `EmailProvider` interface (ADR-0004). No direct Gmail/Outlook SMTP. Vendor SDK added only at this
  milestone.

### 3.17 Delivery / Open / Click / Bounce / Unsubscribe Analytics
- **[MVP]** Ingest provider webhooks (delivered, open, click, bounce, complaint, unsubscribe) into a
  per-send event log; show basic per-campaign metrics.
- **[Future]** Cross-campaign dashboards, engagement scoring.

### 3.18 Unsubscribe / Suppression Management
- **[MVP]** Honor unsubscribes and maintain a **suppression list** (hard bounce, complaint, manual).
  Suppressed/unsubscribed contacts are **never** included in a send. One-click unsubscribe link.

### 3.19 External Content Ingestion
- **[MVP-lite/Future boundary]** Define the ingestion **boundary** (a `ContentSource` port) and store
  ingested items as **review-pending** content. Automated collectors are **[Future]**; the human
  review step and data model may land earlier.

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
- **Scale** — small (~500–1,000 contacts, low campaign volume). Do **not** over-engineer for scale;
  choose simple designs. Revisit only with evidence.
- **Observability** — meaningful logs for auth, approvals, sends, imports, webhook processing.
- **Idempotency** — imports, scheduling, and sending must be safe to retry without duplication.

## 5. MVP Scope (in)

Auth + roles; users; companies; contacts; **CSV/Excel import with validated preview**; brands /
products / industries / tags; segmentation; content library with HE/AR + RTL; campaign builder with
**server-side lifecycle**; email preview; **test send**; **manager approval (four-eyes)**;
scheduling (minimal trigger); **email provider via API behind an interface**; delivery/engagement
event capture; **unsubscribe + suppression**; audit trail for lifecycle actions.

## 6. Out of Scope (MVP)

- Public SaaS / multi-tenancy / customer self-service portals.
- Direct Hashavshevet API/database integration (import is Excel/CSV first).
- Automated external content **collectors** and **AI summarization** (boundary defined; feature later).
- Recurring/triggered automations, drag-and-drop editor, A/B testing, advanced analytics dashboards.
- SSO/MFA, granular permission matrices beyond ADMIN/MANAGER.
- Redis/BullMQ/worker fleet (added only when scheduling/sending proves the need — ADR-0005).

## 7. Data Completeness Requirements (imported / incomplete data)

Imported Hashavshevet data is frequently incomplete. The model and import flow **must** handle this.

**Fields that may be missing** (and therefore **nullable** at the DB layer): contact first name, last
name, phone, email, industry, product interests, brand interests, language, job title, company
metadata.

**Rules:**
1. Company and contact records **must support partial/incomplete data**.
2. Optional business metadata must **not** be `NOT NULL` without a strong integrity reason.
3. Missing segmentation data must **not** prevent importing the customer.
4. Contacts **without email may exist** but are **not eligible** for email campaigns.
5. **Email eligibility is explicit**, never inferred from mere contact existence (§8.2).
6. **Invalid emails are flagged** during import (`emailStatus = INVALID`) and **excluded from sending**.
7. **Missing language = `UNKNOWN`** (explicit), never silently Hebrew.
8. Missing industry/product/brand info is shown as **incomplete data**, enrichable later.
9. Import preview **distinguishes** the categories in §8.4.
10. **Do not discard a whole row** just because optional metadata is missing.
11. **Preserve imported source data** (raw row + batch) for troubleshooting/audit.
12. The UI must make **incomplete profiles easy to identify and enrich**.

> **Required-fields reconciliation (decision requiring validation — ADR-0006):** The brief also
> states `email: required`, `language: required`, `industry: required`. We interpret this as a
> **completeness/eligibility** requirement, **not** a persistence constraint:
> - **Persistence:** `email`, `language`, `industry` are **nullable** — incomplete data always imports.
> - **Eligibility/completeness:** to be a valid target of a **localized, industry-segmented email
>   campaign**, a contact needs a **valid email** (sendable), a **known language** (renderable), and a
>   **known industry** (segmentable). Contacts missing any are imported and stored, marked
>   *incomplete*, and excluded from the relevant sends until enriched.
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

### 8.3 Sending safety

Recipients recomputed live at send; test sends isolated to test addresses; **idempotent** per
(campaign, contact) via a unique send-ledger row; typed confirmation with recipient count for real
sends; environment guard prevents non-prod from mailing real contacts.

### 8.4 Import row classification

Every previewed row is classified as exactly one of:

| Class | Meaning | Imported? | Sendable? |
| --- | --- | --- | --- |
| `SENDABLE` | Valid + complete + valid email + eligible | Yes | Yes |
| `INCOMPLETE` | Valid & importable but missing language/industry/segmentation | Yes | Not for localized/segmented sends until enriched |
| `NO_EMAIL` | No email present | Yes | No (not email-eligible) |
| `INVALID_EMAIL` | Email present but invalid | Yes (flagged `INVALID`) | No |
| `DUPLICATE` | Matches an existing/another row (normalized email or `sourceSystem+externalId`) | Merged/updated, not duplicated | Per merged record |
| `ERROR` | Cannot import (unparseable / missing required integrity key) | No | No |

### 8.5 Segmentation vs eligibility

Resolve the segment first, then apply the eligibility filter. Excluded-but-in-segment contacts are
**counted and visible**, never silently dropped.

### 8.6 Language

`HE | AR | UNKNOWN`. Localized sends exclude `UNKNOWN`-language contacts unless an admin explicitly
overrides per campaign. All content renders RTL for HE and AR.

## 9. Languages

Hebrew and Arabic for content and recipient-facing material (both RTL). The **admin UI** language is
English for MVP (internal tool); UI i18n is a possible future enhancement. Content language is
tracked explicitly per content item and campaign.

## 10. Scale Assumptions

- ~500–1,000 contacts initially; low concurrent users (admin + a few managers); modest campaign
  frequency. Designs should favor simplicity; premature scaling infrastructure is out of scope.

## 11. Open Questions (need business/technical validation)

1. **Required-fields semantics** (§7 / ADR-0006): confirm that `email`/`language`/`industry` are
   *nullable in storage but required for eligibility/completeness*, rather than hard `NOT NULL`.
2. **Email provider choice** (Resend / Postmark / Amazon SES / other) — affects webhook format and
   deliverability setup (SPF/DKIM/DMARC for AXIS domain).
3. **Consent/legal basis:** what consent/opt-in status does Hashavshevet data carry? Is there a legal
   basis to email existing customers, and what unsubscribe wording is required (HE/AR)?
4. **Dedupe key:** is a stable Hashavshevet `externalId` available in exports for idempotent import,
   or must we dedupe on normalized email / name+phone heuristics?
5. **Admin UI language:** English only for MVP, or Hebrew/Arabic admin UI too?
6. **Sender identities/domains:** which from-addresses/domains will AXIS send from?
