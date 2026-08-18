# CLAUDE.md — AXIS Customer Communication Platform

> Operating manual for Claude Code sessions on this repository.
> Read this file **first**, every session, before touching code or docs.
> If a change contradicts this file, update this file in the same change — never let code and this manual drift apart.

---

## Project Overview

An **internal** web application for **AXIS GPS & Mapping Solutions** to manage customer
communication: importing customer contacts, organizing them by industry / product / brand / tags,
building segmented **newsletters and campaigns** in **Hebrew and Arabic**, routing them through a
**manager approval workflow**, and sending them via an external email provider with delivery and
engagement tracking.

It is **not** a public SaaS product. Users are AXIS staff (administrator/developer and company
managers). Optimize for correctness, maintainability, and safety over scale or multi-tenancy.

## Business Context

AXIS sells GPS and mapping hardware/software. **CRM master data is maintained in Monday.com — the
source of truth** (ADR-0007). This platform is a **downstream projection / read model**: it mirrors
companies and contacts from Monday (via the Monday GraphQL API + webhooks) and never writes CRM state
back to Monday in v1. **Hashavshevet is upstream of Monday** (Monday is fed from it) and **must not**
be modeled as a direct source for this platform. Initial scale is small: **~500–2,000 contacts**.
Mirrored data is frequently **incomplete** (empty Monday columns for email, phone, language,
industry, product/brand interests). The platform must accept incomplete data without losing it, make
gaps visible, and let staff **enrich records in Monday** over time — while **never** letting an
incomplete, unconsented, or unsubscribed contact receive email by accident.

Future communication types: newsletters, product announcements, firmware/software updates, training
invitations, webinars, events, technical alerts, promotions, follow-ups. Design the domain to
accommodate these without hard-coding "newsletter" everywhere.

## Technology Stack

Approved and in use (versions are what `create-next-app` provisioned; keep them coherent):

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router) | Server Components + Server Actions / Route Handlers |
| Language | **TypeScript 5** (`strict`) | No `any` without written justification |
| UI | **React 19** + **Tailwind CSS v4** | Tailwind v4 is CSS-first (`@import "tailwindcss"`) |
| Lint | **ESLint 9** (`eslint-config-next`) | Flat config in `eslint.config.mjs` |
| Database | **PostgreSQL** | Relational integrity is a hard requirement |
| ORM | **Prisma** | All schema changes via migrations — **no manual DDL** |
| Auth | **Auth.js (NextAuth v5)** | Credentials for MVP; server-enforced RBAC |
| Container | **Docker** | For Postgres locally, and app image later |
| Email (TEST) | **Gmail SMTP** via `nodemailer` | `smtp.gmail.com:465`, implicit TLS, Google **App Password**; behind the `EmailProvider` port (ADR-0014) |
| Email (bulk, later) | **Provider via HTTP API** (e.g. Resend/Postmark/SES) | Behind the same port; **no bulk vendor SDK committed yet** |
| CRM source | **Monday.com** (GraphQL API + webhooks) | **Source of truth** for CRM master data; platform is a **read-only projection** (ADR-0007) via a `CrmSource` port |
| Send safety | **Send-mode gate** (`TEST` default / `PRODUCTION`) | Server-side safe-send redirect; going live is an explicit admin action (ADR-0008) |
| Email HTML | **One canonical renderer** in `domain/email` | Table-based + inline styles; preview and sender share it (ADR-0011). No email-template library |
| Rich text | **Restricted markup rendered server-side** | No stored client HTML; XSS-safe by construction. No WYSIWYG dependency (ADR-0012) |
| Media | **`MediaStore` port**; **Cloudinary** hosted, local disk fallback | Selected by `MEDIA_PROVIDER`; `CLOUDINARY_URL` is a **secret**; never in `public/`, never in PostgreSQL (ADR-0012/0016) |
| Jobs | Deferred | In-process scheduling first; **Redis/BullMQ only when justified** (see ADR-0005) |

**Not yet installed, and must not be added until its milestone has a concrete need:** Prisma,
Auth.js, a Monday API client, any email vendor SDK, Redis, BullMQ, a component library. Adding one
early is a defect.

## Repository Structure

```
.
├── CLAUDE.md                 # This file — operating manual
├── README.md                 # Human onboarding entry point
├── docs/
│   ├── requirements.md       # Goals, users, functional/non-functional, MVP scope, business rules
│   ├── architecture.md       # Components, boundaries, data flow, diagrams
│   ├── development-plan.md    # Milestone plan (M0–M13) with Definition of Done
│   └── decisions/            # Architecture Decision Records (ADRs)
│       ├── README.md         # ADR process + index
│       └── NNNN-*.md         # Individual ADRs
├── public/                   # Static assets
├── src/
│   ├── app/                  # Next.js App Router (routes, layouts, route handlers)
│   ├── domain/               # Pure domain logic: types, enums, invariants, state machines (NO I/O)
│   ├── server/               # Server-only: services, data access, integrations, auth
│   │   ├── services/         # Use-cases / application layer (orchestrate domain + persistence)
│   │   ├── db/               # Prisma client + repositories (added at DB milestone)
│   │   ├── media/            # MediaStore port + local-disk implementation (dev)
│   │   └── integrations/     # External adapters (Monday CRM, email provider, ingestion) behind interfaces
│   ├── lib/                  # Framework-agnostic shared utilities (validation, formatting)
│   └── ui/                   # Reusable presentational components (RTL-aware)
├── prisma/                   # schema.prisma + migrations (added at DB milestone)
├── var/media/                # Local DEV image uploads — git-ignored, replaced by object storage
├── .env.example              # Documented env vars — no secrets, committed
└── eslint.config.mjs, tsconfig.json, next.config.ts, postcss.config.mjs
```

Directories under `src/` beyond `app/` are created as their milestone arrives; each carries a short
`README.md` describing its responsibility. Do not pre-create empty infrastructure.

## Architecture Rules

1. **Layer separation is enforced by import direction:**
   `ui` / `app` → `server/services` → `domain` + `server/db` + `server/integrations`.
   - `domain/` is pure: no Prisma, no `fetch`, no framework imports. It holds types, enums, and
     business invariants (e.g. the campaign state machine, eligibility rules).
   - `server/` is the only place that talks to the database, the email provider, or the network.
   - `app/` (routes/components) calls **services**, never the database or provider directly.
2. **Business rules live server-side.** UI may mirror rules for UX, but every approval, send,
   eligibility, and state transition **must** be re-validated on the server. Never trust the client.
3. **External systems sit behind an interface.** Email sending, content ingestion, and any vendor
   are accessed through an internal port (`EmailProvider`, `ContentSource`) so the vendor can change
   without touching domain or services. See ADR-0004.
4. **No premature infrastructure.** Introduce Redis/BullMQ/workers/caches only when a milestone
   proves the need, recorded in an ADR. Simpler is the default.
5. **Server Actions / Route Handlers are thin.** They validate input, call a service, map the result
   to a response. No business logic in the route layer.
6. **CRM is a read-only projection.** Monday.com is the source of truth (ADR-0007); services mirror
   CRM master data via a `CrmSource` port and must never write CRM state back to Monday in v1, nor
   let a sync overwrite locally-owned communication state.

## Domain Rules

These are **invariants**. They must hold regardless of UI state. Enforce them in `domain/` and/or
`server/services/`, and back the critical ones with database constraints.

### Campaign approvals & lifecycle

Canonical states and the **only** allowed transitions (see `docs/architecture.md` for the diagram):

```
DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──schedule──▶ SCHEDULED
  ▲                     │                                                  │
  │                     └──reject(reason)──▶ REJECTED ──edit──▶ DRAFT      ▼
  │                                                              SENDING ──▶ SENT
  └────────────────────────── (cancel) ◀── SCHEDULED/APPROVED         │
                                                                 (failure)
                                                                      ▼
                                                                   FAILED
```

- Allowed transitions are defined **once** as a state machine in `domain/`. All transition attempts
  go through it; illegal transitions throw. Never mutate `status` directly in a service or route.
- **Only a `MANAGER` (or `ADMIN`) may `approve` or `reject`.** A user **cannot approve a campaign
  they created** unless they are `ADMIN` (four-eyes principle; validate `createdById !== approverId`
  for managers). Rejection **requires a reason**.
- A campaign is **editable only in `DRAFT`**. Submitting locks content; `REJECTED → DRAFT` unlocks.
- Sending is only permitted from `SCHEDULED` (or `APPROVED` for an immediate send) and moves through
  `SENDING → SENT`. `SENT`, `FAILED`, and `CANCELED` are terminal.
- Every transition writes an **audit record** (who, from-state, to-state, reason, timestamp).

### Sending safety (guard against accidental mass send)

- **Send-mode gate (ADR-0008):** the system runs in **`TEST` / SAFE-SEND mode by default**; real
  customer delivery is **disabled by default**. In `TEST` mode **no email reaches a real CRM
  address** — every delivery is redirected server-side to the configured safe-send address
  (`SAFE_SEND_REDIRECT_TO`, default `khaled-s@axis-gps.com`). The **intended recipient is still
  resolved and logged** (preview + recipient ledger) so segmentation/personalization can be verified.
- **Switching to `PRODUCTION` send mode is an explicit administrative action** — never automatic
  (not because tests pass, not because a campaign is approved). The toggle is audited.
- **Every customer-facing newsletter must include a working, public unsubscribe link** (ADR-0008).
- **Sending requires an explicit, typed confirmation** including the resolved recipient count; in
  `TEST` mode the confirmation states recipients are simulated/previewed and mail goes only to the
  safe-send address.
- The recipient list is **recomputed at send time** from live eligibility — never a stale snapshot.
- Dispatch is **idempotent per (campaign, contact)**: a unique send-ledger row prevents double
  delivery on retry — in **both** `TEST` and `PRODUCTION` modes.
- All of the above is **enforced server-side**; UI restrictions alone are insufficient. A hard
  environment guard additionally prevents non-production environments from mailing real contacts.

### Content, newsletters & automation (ADR-0010)

- **Multi-content newsletters:** a campaign composes **many ordered** content items via
  `CampaignContentItem` (`position`, `isIncluded`, optional heading/intro). The same `ContentItem`
  cannot be added twice to one campaign (`@@unique([campaignId, contentItemId])`).
- **Snapshots are authoritative history:** each `CampaignContentItem` and the campaign-level
  `snapshot*` fields freeze content at approval/send. **Editing a `ContentItem` later never changes
  sent history** (`CampaignContentItem.contentItem` is `onDelete: Restrict`).
- **Internal vs external content:** `ContentItem.origin` = `INTERNAL | INGESTED`. External content
  may be link+title+summary only (`bodyHtml` optional). `ContentSource` holds approved sources
  (URLs are config, not secrets).
- **Automatic collection ≠ automatic sending.** Ingested items are created **`PENDING_REVIEW`** and
  are **not production-usable until `APPROVED`**; a human selects/orders what goes out. External
  ingestion is idempotent by `(sourceId, externalId)`; no network fetching is implemented yet.
- **Recurring automation is ASSISTED:** `NewsletterAutomation` (WEEKLY/MONTHLY) **prepares a DRAFT**
  on schedule; it **never** auto-selects external articles nor auto-sends. One occurrence → at most
  one campaign (`NewsletterAutomationRun @@unique([automationId, scheduledFor])`).
- **Scheduled production send is gated** (never silently sends late): approved (four-eyes) + content
  ready + external content approved + time reached + **production explicitly enabled** + eligibility
  re-evaluated (unsubscribe/suppression re-checked at send). If unapproved at the scheduled time,
  **do not send** — the campaign stays attention-required.
- **Language:** newsletters remain language-specific for delivery; a shared source article may exist
  as separate HE and AR items. Language `UNKNOWN` is valid for un-reviewed ingested content.

### Newsletter rendering & authoring (ADR-0011 / ADR-0012)

- **One rendering path.** `renderNewsletterHtml` in `domain/email/newsletterTemplate.ts` is the **only**
  email HTML generator. The browser preview and any future provider adapter call it with the same
  document, so **what is previewed is what would be sent**. A second "preview-only" layout is a defect.
- The renderer is **pure and deterministic** (same input ⇒ byte-identical output), uses **table layout
  + inline styles**, and sets **real `dir` semantics** for HE/AR — not just `text-align`. `UNKNOWN`
  language stays LTR. Tailwind classes must never be relied on inside email HTML.
- **Layout (ADR-0015):** the **first included item is the featured article** (hero image, `<h1>`, blue
  kicker, pill CTA); the rest are compact `<h2>` blocks. 640px centred container, AXIS logo header,
  centred footer with contact + unsubscribe. Never reproduce another company's branding.
- **Brand logo:** `AXIS_EMAIL_LOGO_URL` is accepted only when `isPublicHttpsUrl` passes — **HTTPS
  only**, no loopback/private/link-local/internal host — otherwise the **text wordmark fallback**
  renders. Displayed at 200px wide with `height:auto` + `max-width:100%` (never stretched or cropped),
  `dir="ltr"` so RTL cannot reorder it, alt text `AXIS Advanced Mapping Solutions`. Cloudinary logos
  are delivered at `c_limit,w_440,q_auto` — a full-size logo is real weight in every message.
- **Latin phrases inside RTL copy are isolated** with `<span dir="ltr">` via `escapeWithLtrIsolation`,
  as **whole phrases** (spaces/commas/ampersands included) — per-word isolation leaves the separators
  neutral and lets punctuation drift to the wrong edge. Isolation runs **before** escaping so an entity
  can never be split. Use the `dir` attribute, not `unicode-bidi` (Outlook ignores the CSS).
- **Image hosting (ADR-0016):** uploads go through the `MediaStore` port — `CloudinaryMediaStore` when
  `MEDIA_PROVIDER=cloudinary`, else local disk. **Local validation (magic bytes, allow-list, SVG
  rejection, 5 MB cap, filename sanitisation) always runs BEFORE any provider call** — the provider is
  a store, not a gatekeeper. Only `secure_url` is persisted; a failed upload yields **no** URL so the
  existing article image is kept. Assets use generated public IDs under `axis-newsletter/content/`.
  `remove()` is a deliberate **no-op** for hosted assets — a sent email still references the URL.
  Email delivery inserts `c_limit,w_1280,q_auto` (idempotent, never `f_auto`/AVIF; WebP→`f_jpg` for
  Outlook). `CLOUDINARY_URL` embeds credentials: never log, persist, return, or expose it.
- **Non-deliverable images are OMITTED** (`deliverableImageUrl`): anything not `http(s)`, or hosted on
  `localhost`/`127.0.0.1`/`0.0.0.0`/`[::1]`, is dropped so a recipient never sees a broken image. The
  same rule guards the "View as webpage" link. Preview and send share the omission — divergence would
  break the approval hash and let someone approve a layout that never arrives.
- **Client-supplied HTML is never stored or emitted.** Authors write a restricted markup; the server
  escapes it and emits only tags it generates itself, so XSS-safety is structural, not sanitizer-based.
  Link schemes are limited to `http`/`https`/`mailto`.
- **Images:** type allow-list + magic-byte sniffing + size cap; **SVG rejected**; the client filename
  never reaches disk (a storage name is generated); files live outside `public/` and are served by a
  handler that pins the content type and sends `nosniff`. Access goes through the **`MediaStore` port**.
- **The test-send surface is non-editable.** Sender `axisgpscana@gmail.com` and recipient
  `khaled-s@axis-gps.com` are hard-coded constants rendered as read-only text (the panel has **no input
  element**), and any other recipient is rejected server-side. Preview itself creates **no** recipient,
  test-send, or event rows and makes no network call.

### SAFE TEST sending via Gmail SMTP (ADR-0013 approval model + ADR-0014 transport)

- **The audience is unrepresentable, not merely validated.** `TestEmailMessage` has **no `from`,
  `cc`, `bcc` or `replyTo`**, and `to` is a single string. The sender is adapter configuration.
  `assertSafeTestEnvelope` re-validates in the service **and** again inside the adapter, refusing
  (never trimming) any attempt to widen the audience.
- **Approval is bound to a SHA-256 of the exact rendered message** (campaign, mode, sender, recipient,
  subject, preheader, ordered content, HTML, text). At send time the newsletter is **re-rendered and
  re-hashed**; any difference blocks the send with *"Newsletter changed after approval…"*. A
  client-supplied `approved=true` is never trusted. Preview and send share `previewDocument`, so the
  reviewed and hashed messages are byte-identical.
- **One approval ⇒ at most one submission**, enforced by a **UNIQUE** `CampaignTestSend.approvalId`.
  The attempt row is written *before* the provider call, so a concurrent/double-clicked request loses
  at the database and never reaches Gmail. Approving again revokes the previous unused approval.
- **SMTP `250` means accepted, never delivered.** Say "Gmail accepted the test email for delivery".
  A broken connection or unreadable result is `UNCERTAIN` and is **never auto-retried** — that could
  duplicate real mail; a human checks the Sent folder.
- **Test sends never touch production ledgers** — only `CampaignTestSend`. No audience resolution, no
  fan-out, `CampaignRecipient`/`CampaignEvent` untouched.
- **Configuration is validated for shape, not just presence**, so a placeholder reports
  *"Gmail test email provider is not configured"* instead of failing opaquely at send time. The
  capability check never opens a connection.
- **Authorized addresses are hard-coded constants** — sender `axisgpscana@gmail.com`, recipient
  `khaled-s@axis-gps.com`. `SAFE_TEST_SENDER`/`SAFE_TEST_RECIPIENT` are **cross-checked against** them,
  never read as the source of truth: an env var must never be able to redirect a test email. A
  mismatch makes sending unavailable. `GMAIL_SMTP_USER` must equal the authorized sender, because
  Gmail sends as the authenticated account.
- **Header/newline injection is refused, not sanitized** — any control character in an address or
  subject can forge an SMTP header (a smuggled `Bcc:`). See `hasHeaderInjection`.
- **Never** log or persist the App Password or any SMTP AUTH data. A normal account password must
  never be requested or stored — only a revocable 16-character Google App Password
  (`docs/gmail-smtp-setup.md`). Gmail is a **test** transport; bulk customer sending still needs the
  ADR-0004 provider.

### Contact consent / eligibility (never email the wrong person)

A contact is **email-eligible** only if **all** hold, re-checked at send time:

1. `status = ACTIVE`, and
2. a **valid** email exists (`emailStatus = VALID`; syntactically valid, present), and
3. the contact is **not unsubscribed** for the relevant scope, and
4. the contact is **not suppressed** (hard bounce, spam complaint, or manual suppression), and
5. **consent is satisfied** where applicable (`consentStatus ≠ DENIED`).

- Eligibility is **derived**, never assumed from "the contact row exists". A contact with no email,
  or an invalid one, may exist but is **not** a valid recipient.
- Unsubscribe and suppression are **append-only**, **locally-owned** facts. Once suppressed/
  unsubscribed, a contact is excluded until an explicit, audited re-subscribe (where legally
  permitted). **A Monday CRM sync must never overwrite or remove unsubscribe/suppression state.**
- Unsubscribing must be honored across all campaigns immediately, via a **public, no-login,
  tokenized** unsubscribe endpoint (ADR-0008).

### Segmentation

- Segments select contacts by industry, product interests, brand interests, and tags.
- Segment resolution to recipients is **separate** from eligibility filtering: resolve the segment,
  then apply the eligibility filter. A contact in a segment but ineligible is **excluded from send**,
  and this exclusion is visible/countable, not silent.
- Contacts missing segmentation metadata are simply not matched by those criteria — they are not
  errors and must still exist and be enrichable.

### Language

- Language is an explicit enum: **`HE`, `AR`, `UNKNOWN`**, held on **`CommunicationAddress`** (per
  normalized email), not on the contact. Missing language is **`UNKNOWN`**, never silently Hebrew and
  never inferred.
- A localized campaign targets a language. **Destinations whose `CommunicationAddress.language` is
  `UNKNOWN` are excluded** from a localized send unless an admin overrides for that campaign. Content
  and layout must render **RTL** for both Hebrew and Arabic.

### CRM data ownership & Monday sync (Monday is the source of truth)

- **Monday.com is the source of truth** for CRM master data; this platform is a **read-only
  projection** (ADR-0007). It mirrors companies/contacts from Monday and **never writes CRM state
  back to Monday** in v1.
> **Authoritative data model: [ADR-0009](docs/decisions/0009-communication-address-and-dedup-ledger.md)**
> (refines ADR-0006/0007 with the real-CRM findings). Key points below.

- **Per-field ownership boundary** — a hard invariant:
  - **Monday-owned (mirrored, read-only, overwritten by every sync):** company/contact identity and
    names, `companyEmail`/`accountingEmail`/`email` (raw) + derived `*Norm`, `companyPhone`/`phone`,
    `jobTitle`, `industry` (Company-level), category, customer status/classification, product links,
    plus provenance (`mondayBoardId`, `mondayItemId`, `mondayUpdatedAt`, `syncedAt`, `rawItem`, `source`).
  - **Locally-owned, email-centric on `CommunicationAddress` (one row per `normalizedEmail`) — a sync
    must NEVER overwrite these:** `emailStatus`, **`language`**, `consentStatus`. (There is **no**
    Monday language/consent field; both default `UNKNOWN`, never inferred.)
  - **Locally-owned, other:** `Unsubscribe`, `Suppression`/`SuppressionEvent`, `Campaign`,
    `CampaignRecipient`, `CampaignRecipientSource`, `CampaignEvent`, `CampaignTestSend`,
    `CampaignAudienceSnapshot`/`Exclusion`, `AuditLog`, `Segment`, archive flags, send-mode config.
- **Composite source identity `(mondayBoardId, mondayItemId)`** is the stable natural key for every
  mirrored record (unique). The local primary key stays a `cuid()`. **Email is never CRM identity**;
  the globally-unique communication identity is **`CommunicationAddress.normalizedEmail`**.
- **`Company↔Contact` is many-to-many via `CompanyContact`** (no mandatory `companyId` on `Contact`).
  **Industry belongs to `Company`**; `Contact` has no industry FK and **no CRM status** column.
  **Brand/Tag are omitted from v1** (absent in Monday). **Products** = `Product` (catalogue) +
  `CustomerProduct` (owned/subscriptions), both Monday-mirrored.
- **Deduplicated delivery:** `CampaignRecipient` is unique on **`(campaignId, normalizedEmail)`** —
  at most one production delivery per campaign+email; every contributing CRM record is preserved in
  `CampaignRecipientSource` (non-null identity). **TEST mode never fans out** — test sends live in
  `CampaignTestSend`; exclusions live in `CampaignAudienceSnapshot`/`Exclusion`, never as fake
  recipient rows.
- **Archive-on-delete:** a Monday item deletion **archives** the local projection (`status = ARCHIVED`
  + `mondayDeletedAt`) and makes it ineligible for sending. **Never hard-delete** a mirrored record,
  especially when campaign history exists.
- **Sync freshness:** store `lastSyncedAt` per board/record. For v1, stale data raises a **visible UI
  warning**; it does **not** auto-block sending.

### CRM synchronization (incomplete data is the norm)

- Sync is **idempotent**: upsert keyed on `(mondayBoardId, mondayItemId)` inside a transaction.
  Monday **GraphQL API** for pulls + verified **webhooks** for incremental change + a scheduled
  reconciliation backstop. Sync executions are audited via **`SyncRun`** (one run) and
  **`SyncItemLog`** (per item); raw webhook events are recorded for idempotency.
- **Company and contact records support partial/incomplete data.** Optional business metadata is
  **nullable** — do not make it `NOT NULL` without a strong integrity reason.
- **A record is never skipped solely because optional metadata is missing.** Only items that violate
  integrity (missing the composite identity, unparseable) are rejected.
- Each synced item is classified for data quality: `SENDABLE`, `INCOMPLETE`, `NO_EMAIL`,
  `INVALID_EMAIL`, `CONFLICT`, `ERROR` (see `docs/requirements.md` §8.4). Because **Monday owns record
  merges**, duplicate/ambiguous identities are **reported as `CONFLICT`**, not merged locally.
- **Invalid emails are flagged** (`emailStatus = INVALID`) and **excluded from sending**, but the
  contact is still mirrored so staff can fix it in Monday.
- The **raw Monday item snapshot is preserved** (`rawItem` + `SyncItemLog`) for troubleshooting/audit.
- **CSV/Excel import is a secondary, optional admin/developer fallback** (bootstrap/backfill) — **not**
  a normal user workflow. If present it reuses the same classification and idempotent-upsert rules and
  must never become the primary ingestion path.

> **Required-fields note (validated decision):** At the **persistence layer**, `email`, `language`,
> and `industry` are **nullable** (so incomplete Monday CRM data always mirrors in). At the
> **eligibility/completeness layer**, all three are **required for a contact to be a valid target of
> a localized, industry-segmented email campaign**: valid email ⇒ *sendable*, known language ⇒
> *renderable*, known industry ⇒ *segmentable*. This reconciles the brief's data-quality rules with
> its "required" note. **See ADR-0006 (origin/dedupe amended by ADR-0007).**

## Coding Standards

- **TypeScript:** `strict` on. Avoid `any`; prefer precise types, discriminated unions for state,
  and `unknown` + narrowing at boundaries. Export domain types from `domain/`.
- **No magic strings.** Statuses, roles, languages, email/consent states, row classifications, etc.
  are **enums or `as const` union types** in `domain/`, used everywhere. No stray string literals.
- **Validation at the boundary.** Validate and parse all external input (form data, Monday API
  payloads/webhooks, provider webhooks, optional CSV rows) into typed domain objects before use. Use
  one schema library consistently (introduce it when the first real input arrives; record the choice).
- **Errors:** throw typed domain errors (e.g. `IllegalStateTransitionError`, `NotEligibleError`);
  map to user-facing messages in the route/action layer. Never swallow errors silently.
- **Services** are the application layer: one use-case per function, transactional where it mutates
  multiple rows, returning typed results. Routes/actions call services.
- **Database access** goes through `server/db` only. Domain and UI never import Prisma.
- **UI:** Server Components by default; add `"use client"` only when interactivity requires it.
  Components are small, typed, and RTL-aware.
- **Naming:** `PascalCase` types/components, `camelCase` values/functions, `SCREAMING_SNAKE_CASE`
  enum members, `kebab-case` files for non-components. Descriptive over terse.
- **Comments** state constraints and "why", not "what". Match surrounding style.

## Security Rules

- **No secrets in the repo, ever.** All secrets come from environment variables. `.env` is
  git-ignored; **`.env.example` documents every variable with placeholder values** and is committed.
- **Authentication:** Auth.js. All non-public routes/actions require a valid session.
- **Authorization:** role-based (`ADMIN`, `MANAGER`), **enforced server-side** in services — not
  merely by hiding UI. Approval/four-eyes and send permissions are checked on the server.
- **Mass-mail protection** (see Domain Rules → Sending safety) is a security control, not just UX:
  the server-side `SEND_MODE` safe-send gate (`TEST` default), typed confirmation, live eligibility
  recompute, idempotent send ledger, and environment guard. Going to `PRODUCTION` is an explicit,
  audited admin action — never automatic.
- **Input validation** on every external boundary; treat **Monday API responses/webhooks**, provider
  webhooks, and optional CSV/Excel uploads as **untrusted**. Verify webhook signatures (Monday
  signing secret + challenge handshake; email-provider signatures) before processing.
- **Public unsubscribe endpoint** must be safe for anonymous recipient use: no login, an unguessable
  scoped token, no enumerable identifiers, rate-limited.
- **Least privilege** for DB and provider credentials. Log security-relevant actions (auth,
  approvals, sends) to the audit trail.

## Database Rules

- **Prisma migrations are the only way to change schema.** Never hand-edit the database or use
  `db push` against anything but a throwaway local DB. Commit migrations with the code that needs them.
- **Integrity in the database, not just the app:** foreign keys, `UNIQUE` constraints (e.g. composite
  CRM identity `(mondayBoardId, mondayItemId)`; one active unsubscribe per contact/scope; one
  send-ledger row per campaign+contact), `CHECK`/enum types, and `NOT NULL` **only** for genuinely
  required fields.
- **Optional business metadata is nullable** (see Domain/Import rules). Required for integrity ≠
  required by business.
- **Indexes** on foreign keys, the composite `(mondayBoardId, mondayItemId)` identity, and columns
  used for segmentation/eligibility filtering and lookups (email, status, language, industry, tag
  joins, `lastSyncedAt`).
- **IDs:** use CUIDs/UUIDs (Prisma default `cuid()`), not exposed auto-increment integers.
- **Timestamps:** every table has `createdAt` and `updatedAt`. Append-only audit/event tables keep
  their own immutable `occurredAt`.
- **Transactions** wrap multi-row mutations (CRM sync commit, send ledger writes, state transition +
  audit) so they are all-or-nothing.
- **Sync-immune local state:** `Unsubscribe`, `Suppression`, and the campaign tables are locally
  owned; the CRM sync writes only mirrored projection fields and must never update or delete them.
- **Money/enums as domain types**, not free text.

## UI/UX Rules

- **RTL from the start.** Hebrew and Arabic are RTL. Set `dir` from the active locale; use Tailwind
  **logical properties** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start/end`) instead of left/right.
  Never hard-code physical directions in layout that must mirror.
- **Multilingual content** (HE/AR) is first-class; components must render either direction cleanly,
  including mixed LTR content (URLs, product codes) inside RTL text.
- **Responsive** and **accessible**: semantic HTML, labels, keyboard navigation, sufficient contrast,
  focus states. Consider these as you build, not after.
- **Destructive or irreversible actions** (send, delete, suppress, approve) require an explicit
  confirmation state that names the consequence and, for sending, the recipient count.
- **Incomplete data is visible:** the UI must make incomplete contact profiles (missing email,
  language, industry, etc.) easy to spot; enrichment happens in Monday (the source of truth).
- **UI-first operations:** normal users perform **all** operational workflows — CRM sync,
  segmentation, campaign building, approval, and sending — through the **application UI**.
  Terminal/CLI commands are for developers/infrastructure only and must never be a required step in a
  business workflow.
- **Send-mode indicator:** the UI must clearly show whether the system is in **`TEST MODE`** or
  **`PRODUCTION SEND MODE`** at all times. In `TEST MODE`, the campaign confirmation must state that
  recipients are simulated/previewed and the actual email is sent only to the safe-send address
  (`khaled-s@axis-gps.com`).
- **Stale-sync warning:** when the local CRM projection is stale (`lastSyncedAt` beyond threshold),
  show a visible warning; in v1 this warns rather than blocks sending.

## Testing Expectations

- **Unit** (fast, no I/O): domain logic — the campaign state machine, eligibility rules, segment
  resolution, sync-item classification, email validation, and the safe-send address resolver. Test
  invariants thoroughly, including illegal transitions and edge cases (no email, UNKNOWN language,
  archived, conflicts).
- **Integration** (with a test Postgres): repositories/services, CRM sync idempotency, send ledger
  uniqueness, transactional rollback, and that a sync does **not** overwrite locally-owned state.
- **E2E** (later, key flows): login → CRM sync → build campaign → approve → test/production send.
- **Mandatory sending & subscription safety tests (ADR-0008) — must exist before real sends:**
  - an **unsubscribed contact cannot receive** a campaign;
  - **unsubscribe persists across CRM synchronization** (a sync never resurrects it);
  - **`TEST` mode cannot send to a real customer email**;
  - **`TEST` mode sends only to `khaled-s@axis-gps.com`**;
  - **switching to `PRODUCTION` mode is explicit** (never automatic);
  - **duplicate-send protection holds in both `TEST` and `PRODUCTION`** modes.
- A change to a domain invariant **must** come with tests. Do not claim success while tests fail —
  report failures exactly.

## Git / Change Management

- Make **focused** changes: one concern per change. Do not mix unrelated refactors into feature work.
- **Do not silently rewrite architecture.** A structural or dependency change needs an ADR and a
  CLAUDE.md/doc update in the same change.
- Keep dependencies minimal and justified; adding one is a decision, not a convenience.
- Do not commit unless asked. When you do, write a clear message scoped to the change.

## Documentation Discipline

Whenever an **architectural or business decision changes**, update the relevant documentation in the
**same change**: `CLAUDE.md` for rules, `docs/architecture.md` for structure, `docs/requirements.md`
for scope/rules, and add/supersede an **ADR** in `docs/decisions/`. Documentation drift is treated
as a defect.

## Claude Working Protocol

Every task follows these steps:

1. **Read relevant documentation first** — this file, then the applicable `docs/*` and ADRs.
2. **Inspect existing implementation** before editing — never assume; grep/read the code.
3. **State a short implementation plan** before non-trivial changes.
4. **Make focused changes** — one concern, respecting the layer boundaries above.
5. **Run relevant checks/tests** — `lint`, `typecheck`, `test`, and `build` where reasonable.
6. **Do not hide failures** — report errors exactly; do not claim success if checks fail.
7. **Update documentation** if architecture or behavior changed (see Documentation Discipline).
8. **Finish with the Task Summary format** below.

### Required Task Summary format

End every task with:

1. **Executive Summary** — what was established/changed.
2. **Repository Changes** — exact files/directories created or modified.
3. **Architecture Decisions** — important decisions and why (link ADRs).
4. **Commands Executed** — important setup/check commands run.
5. **Validation Results** — Build / Typecheck / Lint / Tests: PASS / FAIL / NOT RUN (exact).
6. **Assumptions / Open Questions** — anything needing a business/technical decision.
7. **Risks / Technical Debt** — real, known risks only.
8. **Current Project State** — what is ready now.
9. **Recommended Next Task** — exactly one; do not start it until explicitly asked.
