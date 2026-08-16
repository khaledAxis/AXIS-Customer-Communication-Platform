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

Mapping to the brief's numbering: M1→(foundation for) auth, M2=Auth, M3=Companies/Contacts(+taxonomy),
M4=Import, M5=Segmentation, M6=Content/multilingual, M7=Campaign builder, M8=Approval, M9=Email/test,
M10=Unsubscribe/Suppression+analytics intake, M11=Scheduling/real send+engagement analytics,
M12=Ingestion, M13=AI.

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

## Milestone 3 — Companies, Contacts & Core Taxonomy

- **Objective:** Model customers with **partial-data support** and explicit eligibility, plus the
  taxonomy contacts depend on.
- **Deliverables:** `Company`, `Contact` (almost all fields nullable; `email` normalized+nullable,
  `emailStatus`, `language HE|AR|UNKNOWN`, `status`, `consentStatus`, `rawSource`), `Industry`,
  `Brand`, `Product`, `Tag`, and contact↔interest/tag relations; domain **eligibility** function and
  **email validation** in `domain/`; CRUD UI (RTL-aware) with incomplete-profile indicators; audit
  scaffold.
- **Dependencies:** M2.
- **DoD:** can create/edit companies/contacts with missing metadata without errors; eligibility is a
  tested pure function; DB constraints correct (nullable optional fields, unique normalized email
  where present); unit tests for eligibility + email validation.

## Milestone 4 — CSV/Excel Import

- **Objective:** Import Hashavshevet exports safely with a validated preview.
- **Deliverables:** upload + column mapping; **PREVIEW** (parse/validate/classify: `SENDABLE`,
  `INCOMPLETE`, `NO_EMAIL`, `INVALID_EMAIL`, `DUPLICATE`, `ERROR`) with **zero writes**; **COMMIT**
  as idempotent upsert in a transaction; `ImportBatch` + `ImportRow` with **raw source** preserved;
  dedupe by normalized email / `sourceSystem+externalId`; classification logic in `domain/`.
- **Dependencies:** M3.
- **DoD:** preview never persists; commit is idempotent (re-import updates, no duplicates); invalid
  emails flagged not dropped; rows with only-missing-optional-data import; integration tests for
  idempotency + classification; raw data retained for audit.

## Milestone 5 — Taxonomy Management & Segmentation

- **Objective:** Manage taxonomy and build segments; preview eligible recipients.
- **Deliverables:** taxonomy admin UI; `Segment` model + builder combining industry/product/brand/
  tags (AND/OR); segment resolution service; preview showing resolved vs **eligible** vs excluded
  counts (eligibility applied separately from selection).
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

## Milestone 9 — Email Provider Integration & Test Sends

- **Objective:** Integrate an external provider behind a port; enable safe test sends.
- **Deliverables:** `EmailProvider` port + one vendor adapter (Resend/Postmark/SES — to be chosen);
  provider key via env; **test send** to explicit test addresses only (isolated code path); render
  pipeline (HTML + unsubscribe placeholder); ADR-0004 finalized with the chosen vendor.
- **Dependencies:** M7 (M8 for gating real sends later).
- **DoD:** test send reaches only test addresses and **cannot** fan out to a segment; vendor code
  confined to the adapter; no vendor types leak into domain/services; secrets not committed.

## Milestone 10 — Unsubscribe / Suppression + Event Intake

- **Objective:** Guarantee unsubscribed/suppressed recipients are never emailed; capture provider
  events. **This gates real sends.**
- **Deliverables:** `Unsubscribe` + `Suppression` (append-only); one-click unsubscribe endpoint +
  link token; verified provider **webhook** handler mapping delivered/open/click/bounce/complaint/
  unsubscribe into `CampaignEvent`; hard bounces/complaints auto-suppress; eligibility recompute uses
  these facts.
- **Dependencies:** M3, M9.
- **DoD:** eligibility excludes unsubscribed/suppressed at **send time**; unsubscribe honored across
  all campaigns immediately; webhook signatures verified; bounce/complaint → suppression tested;
  integration tests prove a suppressed contact is never selected.

## Milestone 11 — Scheduling, Real Sends & Engagement Analytics

- **Objective:** Schedule and execute real sends **safely and idempotently**; report engagement.
- **Deliverables:** `sendAt` scheduling; minimal **due-campaign trigger** (secured cron/in-process);
  send service with **idempotent per-(campaign,contact) ledger** (`CampaignRecipient` unique),
  **live eligibility recompute**, typed confirmation + recipient count, **environment guard**; SENDING
  →SENT/FAILED transitions; per-campaign delivery/open/click/bounce metrics from events.
  **Workers/queue (BullMQ+Redis) only if in-process proves insufficient (ADR-0005).**
- **Dependencies:** M8 (approval gate), M10 (suppression gate), M9 (provider).
- **DoD:** a due approved campaign sends once per eligible contact even across retries; no send to
  ineligible/suppressed/unsubscribed; non-prod cannot mail real contacts; metrics render;
  idempotency + eligibility integration-tested. **No queue introduced unless justified and ADR'd.**

## Milestone 12 — External Content Ingestion Boundary

- **Objective:** Establish ingestion as a port feeding review-pending content.
- **Deliverables:** `ContentSource` port; ingested `ContentItem`s stored **review-pending**; human
  review/approve step before campaign use; one simple/manual source to prove the boundary. Automated
  collectors remain later work.
- **Dependencies:** M6.
- **DoD:** ingested content cannot be used until human-approved; ingestion vendor/detail confined
  behind the port; no automated collector shipped unless explicitly scoped.

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
- No secrets committed; no premature infrastructure.
