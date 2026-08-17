# Development Plan — AXIS Customer Communication Platform

Milestone-based plan for the MVP and the labeled path into future work. Each milestone lists
**Objective**, **Deliverables**, **Dependencies**, and **Definition of Done (DoD)**. Build in order;
do not pull future infrastructure forward. Update this file when scope or sequencing changes.

## Sequencing note (improvements over the suggested order)

The brief's suggested order is sound; three dependency-driven adjustments were made:

1. **A dedicated Database & ORM foundation milestone (M1) precedes Authentication** — Auth.js needs a
   `User` table and migrations, so the persistence layer must exist first.
2. **Core taxonomy (Industry/Brand/Product/Tag) is delivered with Contacts (M3)**, because contacts
   reference `Industry` and import maps to these entities; full segmentation UI remains a later
   milestone (M5).
3. **Unsubscribe/Suppression (M10) is enforced *before* any real (non-test) send (M11).** Test sends
   (M9) are isolated to test addresses and are safe earlier, but a real audience send must not go
   live until suppression/eligibility enforcement exists.
4. **CRM ingestion is Monday sync, not CSV import (ADR-0007).** Monday.com is the source of truth; M4
   mirrors CRM data **read-only**. CSV/Excel remains only an optional admin fallback. Sending ships in
   `TEST`/SAFE-SEND mode by default; `PRODUCTION` is an explicit toggle (ADR-0008).

Mapping to the brief's numbering: M1→(foundation for) auth, M2=Auth, M3=Companies/Contacts(+taxonomy),
M4=**Monday CRM sync** (CSV optional), M5=Segmentation, M6=Content/multilingual, M7=Campaign builder,
M8=Approval, M9=Email + TEST/SAFE-SEND, M10=Unsubscribe/Suppression+analytics intake,
M11=Scheduling/production send+engagement analytics, M12=Ingestion, M13=AI.

---

## Milestone 0 — Project Foundation  ✅ (this milestone)

- **Objective:** Establish a clean, documented engineering foundation.
- **Deliverables:** Next.js 16 + TS (strict) + Tailwind v4 + ESLint 9 scaffold; `src/` layering
  (`app`, `domain`, `server`, `lib`, `ui`) with responsibility READMEs; `CLAUDE.md`; `docs/`
  (requirements, architecture, plan, ADRs); `.env.example`; RTL-ready root layout; passing
  lint/typecheck/build.
- **Dependencies:** none.
- **DoD:** repo assessed; docs + ADRs written; app scaffolds and **builds, type-checks, and lints
  clean**; no premature infrastructure (no Prisma/Auth/email/Redis yet); no secrets committed.

## Milestone 1 — Database & ORM Foundation

- **Objective:** Stand up PostgreSQL + Prisma with the migration workflow.
- **Deliverables:** Docker Compose for local Postgres; Prisma installed and initialized;
  `prisma/schema.prisma` with datasource/generator and a **baseline migration**; `server/db` Prisma
  client singleton; seed script scaffold; `db:*` npm scripts; `DATABASE_URL` in `.env.example`;
  ADR confirming Prisma usage (ADR-0002 already drafted).
- **Dependencies:** M0.
- **DoD:** `prisma migrate dev` creates the DB from migrations; client generates; app connects in
  dev; **no manual DDL**; integration test harness can spin up a test DB.

## Milestone 2 — Authentication & Roles

- **Objective:** Secure the app with Auth.js and server-enforced RBAC.
- **Deliverables:** Auth.js (NextAuth v5) credentials provider; `User` model (hashed passwords,
  `role: ADMIN|MANAGER`); login/logout; session on all non-public routes; server-side authz helper
  used by services; seed initial admin from env; ADR-0003.
- **Dependencies:** M1.
- **DoD:** unauthenticated users are blocked server-side; role checks enforced in a service (not just
  UI); passwords hashed; no credentials committed; unit tests for authz helper.

## Milestone 3 — Companies, Contacts, CommunicationAddress & Products (data foundation)

- **Objective:** Model the CRM projections + email-centric communication state per **ADR-0009**
  (authoritative), with partial-data support and derived eligibility. *(This is the first real DB
  implementation phase.)*
- **Deliverables:** `Company`, `Contact` **Monday projections** (identity `(mondayBoardId,
  mondayItemId)`, `source`, `syncedAt`, `archivedAt`/`mondayDeletedAt`, `rawItem`; almost all fields
  nullable; raw emails + derived `*Norm`; `fullName` only — no first/last split; **no** contact CRM
  status); **`CommunicationAddress`** (per `normalizedEmail`, owns `emailStatus`/`language`/
  `consentStatus`, sync-immune); **`CompanyContact`** many-to-many; `Industry` + `CustomerClassification`
  reference tables (**Company-level**); `Category` mirrored string; **`Product`** (catalogue) +
  **`CustomerProduct`** (owned/subscriptions) + optional `CompanyProduct`; the delivery/audience models
  (`Campaign`, `CampaignRecipient` unique `(campaignId, normalizedEmail)`, `CampaignRecipientSource`,
  `CampaignAudienceSnapshot`/`Exclusion`, `CampaignTestSend`, `CampaignEvent`), `Unsubscribe`,
  `Suppression`/`SuppressionEvent`, `AuditLog`, sync models; pure `domain/` **email normalization** +
  **eligibility** + **audience-dedup** functions; unit tests. **Brand/Tag omitted (absent in Monday).**
- **Dependencies:** M2 (schema can be authored/validated before M2 is complete).
- **DoD:** schema validates and the client generates; projections persist incomplete data without
  errors; ownership boundary respected (comms fields only on `CommunicationAddress`, never sync-written);
  eligibility is a tested pure function (no stored `eligible` flag); DB constraints correct (composite
  identity, `(campaignId, normalizedEmail)`, non-null source identity); duplicate-send + exclusion +
  test-send unit tests pass. Real migration runs once a Postgres `DATABASE_URL` is configured.

## Milestone 4 — Monday CRM Synchronization

- **Objective:** Mirror CRM master data from **Monday.com** (source of truth) into the local
  projection — read-only, safely, idempotently (ADR-0007).
- **Deliverables:** `CrmSource` port + Monday adapter (GraphQL); `MondayBoard` registration + column
  **mapping config**; incremental **webhook** handler (challenge + signature verified) and a scheduled
  **reconciliation** pull; **idempotent upsert** keyed on `(mondayBoardId, mondayItemId)` in a
  transaction; per-item **classification** (`SENDABLE`/`INCOMPLETE`/`NO_EMAIL`/`INVALID_EMAIL`/
  `CONFLICT`/`ERROR`) in `domain/`; `SyncRun` + `SyncItemLog` + `MondayWebhookEvent`; `rawItem`
  snapshot; **archive-on-delete**; `lastSyncedAt` freshness + stale warning; taxonomy values mirrored
  and normalized. **No write-back to Monday.**
- **Dependencies:** M3.
- **DoD:** sync is idempotent (re-sync updates, no duplicates); a sync **never overwrites**
  locally-owned state (unsubscribe/suppression/comms); invalid emails flagged not dropped; records
  with only-missing-optional-data mirror; Monday deletion archives (no hard delete with history);
  integration tests for idempotency, classification, and ownership protection; raw snapshots retained.
- **Secondary/optional:** a CSV/Excel admin fallback reusing the same classification + upsert rules —
  **not** a normal user workflow.

## Milestone 5 — Taxonomy (mirrored) & Segmentation

- **Objective:** Expose Monday-mirrored taxonomy and build segments; preview eligible recipients.
- **Deliverables:** read/normalization views over **Monday-mirrored** industry/product/brand/tag
  vocabularies (**no local master CRUD in v1**); `Segment` model + builder combining
  industry/product/brand/tags (AND/OR); segment resolution service; preview showing resolved vs
  **eligible** vs excluded counts (eligibility applied separately from selection).
- **Dependencies:** M3 (M4 for real data).
- **DoD:** segments resolve deterministically; excluded-but-matched contacts are counted/visible;
  resolution + eligibility filtering unit/integration tested.

## Milestone 6 — Content Library & Multilingual (HE/AR) + RTL

- **Objective:** Reusable content with explicit language and correct RTL rendering.
- **Deliverables:** `ContentItem` (title/body/media refs, `language HE|AR`, `source`
  INTERNAL|INGESTED, review state); content CRUD; RTL rendering verified for HE and AR incl. mixed
  LTR fragments; internal vs ingested (review-pending) distinction.
- **Dependencies:** M2 (M5 helps but not required).
- **DoD:** content renders correctly RTL in both languages; `UNKNOWN` never silently assumed;
  ingested items are review-pending and unusable until approved.

## Milestone 7 — Campaign Builder + Lifecycle + Preview

- **Objective:** Compose campaigns governed by the server-side state machine.
- **Deliverables:** `Campaign` model; **domain state machine** (DRAFT→PENDING_APPROVAL→APPROVED→
  SCHEDULED→SENDING→SENT; PENDING_APPROVAL→REJECTED→DRAFT; +CANCELED/FAILED); builder UI (subject,
  language, segment, content, sender); **content editable only in DRAFT**; accurate HTML **preview**
  with merge fields; every transition audited.
- **Dependencies:** M5, M6.
- **DoD:** illegal transitions rejected server-side and unit-tested; editing blocked outside DRAFT;
  preview matches send rendering; transitions produce audit records.

## Milestone 8 — Approval Workflow

- **Objective:** Enforce manager approval with four-eyes.
- **Deliverables:** submit/approve/reject actions; **four-eyes** (creator ≠ approver unless ADMIN)
  enforced in services; rejection requires a reason and returns to DRAFT; approval audit trail; UI
  for the reviewer queue.
- **Dependencies:** M7, M2.
- **DoD:** a creator cannot approve their own campaign (unless ADMIN); rejection reason required;
  all decisions audited; server-side enforcement covered by tests (UI-bypass attempts fail).

## Milestone 9 — Email Provider Integration & TEST/SAFE-SEND Mode

- **Objective:** Integrate an external provider behind a port; ship the server-side **safe-send gate**
  with `TEST` mode as the default (ADR-0008).
- **Deliverables:** `EmailProvider` port + one vendor adapter (Resend/Postmark/SES — to be chosen);
  provider key via env; **safe-send gate** resolving the effective address (`TEST` →
  `SAFE_SEND_REDIRECT_TO`, default `khaled-s@axis-gps.com`; `PRODUCTION` → real), intended recipient
  retained on the ledger; render pipeline (HTML + working unsubscribe link); `SEND_MODE` config +
  **UI mode indicator**; ADR-0004 finalized with the chosen vendor.
- **Dependencies:** M7 (M8/M10 gate real sends later).
- **DoD:** in `TEST` mode **no email reaches a real address** and all mail goes only to the safe-send
  address; the gate is **server-side** (UI cannot bypass); vendor code confined to the adapter; no
  vendor types leak into domain/services; secrets not committed; unit tests for the safe-send resolver.

## Milestone 10 — Unsubscribe / Suppression + Event Intake

- **Objective:** Guarantee unsubscribed/suppressed recipients are never emailed and that unsubscribe
  is **locally owned and sync-immune**; capture provider events. **This gates real sends.**
- **Deliverables:** `Unsubscribe` + `Suppression` (append-only, **locally owned**); a **public,
  no-login, tokenized** unsubscribe endpoint; verified provider **webhook** handler mapping
  delivered/open/click/bounce/complaint/unsubscribe into `CampaignEvent`; hard bounces/complaints
  auto-suppress; eligibility recompute uses these facts.
- **Dependencies:** M3, M9.
- **DoD:** eligibility excludes unsubscribed/suppressed at **send time**; unsubscribe honored across
  all campaigns immediately; **a CRM sync never removes/overwrites unsubscribe/suppression**; webhook
  signatures verified; bounce/complaint → suppression tested; integration tests prove a suppressed
  contact is never selected **and that unsubscribe persists across sync**.

## Milestone 11 — Scheduling, Production Sends & Engagement Analytics

- **Objective:** Schedule and execute real sends **safely and idempotently**; enable the explicit
  `PRODUCTION` switch; report engagement.
- **Deliverables:** `sendAt` scheduling; minimal **due-campaign trigger** (secured cron/in-process);
  send service with **idempotent per-(campaign,contact) ledger** (`CampaignRecipient` unique),
  **live eligibility recompute**, typed confirmation + recipient count, **environment guard**, and the
  **explicit `TEST`→`PRODUCTION` mode switch (admin action, audited — never automatic)**;
  SENDING→SENT/FAILED transitions; per-campaign delivery/open/click/bounce metrics from events.
  **Workers/queue (BullMQ+Redis) only if in-process proves insufficient (ADR-0005).**
- **Dependencies:** M8 (approval gate), M10 (suppression gate), M9 (provider + safe-send gate).
- **DoD:** a due approved campaign sends once per eligible contact even across retries; no send to
  ineligible/suppressed/unsubscribed; non-prod cannot mail real contacts; switching to `PRODUCTION`
  is explicit; metrics render. **Mandatory tests (ADR-0008):** unsubscribed cannot receive; unsubscribe
  persists across sync; `TEST` cannot mail a real address and sends only to `khaled-s@axis-gps.com`;
  production switch is explicit; **duplicate-send protection holds in both modes.** No queue introduced
  unless justified and ADR'd.

## Milestone 12 — External Content Ingestion, Multi-content & Recurring Automation (ADR-0010)

- **Objective:** Newsletter composition + reviewed external content + recurring automation. *(Schema
  landed in the M3 foundation; this milestone builds the services/UI.)*
- **Deliverables:** multi-content builder (`CampaignContentItem` ordering/snapshots); `ContentSource`
  + `ContentIngestionRun`; **Content Inbox** review (PENDING_REVIEW → APPROVED); `NewsletterAutomation`
  (WEEKLY/MONTHLY, ASSISTED) preparing DRAFTs via idempotent `NewsletterAutomationRun`; scheduled-send
  gating. A `ContentSource` **port** for future collectors (no network fetch yet).
- **Dependencies:** M6, M7, M8 (approval), M11 (scheduled/production send).
- **DoD:** ingested content cannot be used until human-approved; automatic collection never
  auto-sends; automation prepares DRAFTs only and never bypasses four-eyes; one occurrence → at most
  one campaign; scheduled campaigns re-evaluate eligibility and never send if unapproved; no automated
  collector/AI shipped unless explicitly scoped.

## Milestone 13 — AI-Assisted Summarization  [Future]

- **Objective:** Summarize/normalize ingested content with an LLM (Claude), human-reviewed.
- **Deliverables:** summarization behind a service using the Claude API; suggestions always
  human-reviewed before use; cost/rate controls.
- **Dependencies:** M12.
- **DoD:** no AI output reaches recipients without human approval; provider/key abstracted and
  secret; explicitly deferred until prior milestones are stable.

---

## Cross-cutting Definition of Done (every milestone)

- Domain invariants live in `domain/` and are **unit-tested** (incl. edge/illegal cases).
- Server-side enforcement of authz and business rules (never UI-only).
- `npm run lint`, `npm run typecheck`, and relevant tests **pass**; failures reported exactly.
- Migrations (not manual DDL) for any schema change; `.env.example` updated for new config.
- Docs updated (`CLAUDE.md`/`architecture.md`/`requirements.md`) and an **ADR** added for
  architectural/dependency decisions.
- **CRM stays read-only toward Monday** (no write-back in v1); a sync never overwrites locally-owned state.
- **Send safety holds:** `TEST`/SAFE-SEND is the server-enforced default; `PRODUCTION` is an explicit toggle.
- No secrets committed; no premature infrastructure.
