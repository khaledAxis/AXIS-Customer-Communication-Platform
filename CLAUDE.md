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

AXIS sells GPS and mapping hardware/software. Customer records live primarily in **Hashavshevet**
(the accounting system) and are exported to **Excel/CSV** for import here. Initial scale is small:
**~500–1,000 contacts**. Imported data is frequently **incomplete** (missing email, phone, language,
industry, product/brand interests). The platform must accept incomplete data without losing it, make
gaps visible, and let staff enrich records over time — while **never** letting an incomplete or
unconsented contact receive email by accident.

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
| Email | **Provider via HTTP API** (e.g. Resend/Postmark/SES) | Behind an internal interface; **no vendor SDK committed until the sending milestone** |
| Jobs | Deferred | In-process scheduling first; **Redis/BullMQ only when justified** (see ADR-0005) |

**Not yet installed, and must not be added until its milestone has a concrete need:** Prisma,
Auth.js, any email vendor SDK, Redis, BullMQ, a component library. Adding one early is a defect.

## Repository Structure

```
.
├── CLAUDE.md                 # This file — operating manual
├── README.md                 # Human onboarding entry point
├── docs/
│   ├── requirements.md       # Goals, users, functional/non-functional, MVP scope, business rules
│   ├── architecture.md       # Components, boundaries, data flow, diagrams
│   ├── development-plan.md    # Milestone plan (M0–M12) with Definition of Done
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
│   │   └── integrations/     # External adapters (email provider, ingestion) behind interfaces
│   ├── lib/                  # Framework-agnostic shared utilities (validation, formatting)
│   └── ui/                   # Reusable presentational components (RTL-aware)
├── prisma/                   # schema.prisma + migrations (added at DB milestone)
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

- **Sending requires an explicit, typed confirmation** including the resolved recipient count.
- The recipient list is **recomputed at send time** from live eligibility — never a stale snapshot.
- **A "test send" goes only to explicit test addresses** and never touches the real audience; it is
  a different code path and cannot fan out to the segment.
- Dispatch is **idempotent per (campaign, contact)**: a unique send-ledger row prevents double
  delivery on retry. Re-running a send never re-mails an already-sent recipient.
- There must be a hard, server-side **environment guard**: non-production environments must not send
  to real contacts unless explicitly configured.

### Contact consent / eligibility (never email the wrong person)

A contact is **email-eligible** only if **all** hold, re-checked at send time:

1. `status = ACTIVE`, and
2. a **valid** email exists (`emailStatus = VALID`; syntactically valid, present), and
3. the contact is **not unsubscribed** for the relevant scope, and
4. the contact is **not suppressed** (hard bounce, spam complaint, or manual suppression), and
5. **consent is satisfied** where applicable (`consentStatus ≠ DENIED`).

- Eligibility is **derived**, never assumed from "the contact row exists". A contact with no email,
  or an invalid one, may exist but is **not** a valid recipient.
- Unsubscribe and suppression are **append-only** facts. Once suppressed/unsubscribed, a contact is
  excluded until an explicit, audited re-subscribe (where legally permitted).
- Unsubscribing must be honored across all campaigns immediately.

### Segmentation

- Segments select contacts by industry, product interests, brand interests, and tags.
- Segment resolution to recipients is **separate** from eligibility filtering: resolve the segment,
  then apply the eligibility filter. A contact in a segment but ineligible is **excluded from send**,
  and this exclusion is visible/countable, not silent.
- Contacts missing segmentation metadata are simply not matched by those criteria — they are not
  errors and must still exist and be enrichable.

### Language

- Language is an explicit enum: **`HE`, `AR`, `UNKNOWN`**. Missing language is **`UNKNOWN`**, never
  silently defaulted to Hebrew.
- A localized campaign targets a language. **Contacts with `UNKNOWN` language are excluded** from a
  localized send unless an admin explicitly overrides for that campaign. Content and layout must
  render **RTL** for both Hebrew and Arabic.

### Imports (incomplete data is the norm)

- Import is **two-phase**: **PREVIEW** (parse + validate + classify, **zero writes**) then **COMMIT**
  (idempotent upsert inside a transaction). Nothing is persisted to customer tables during preview.
- **Company and contact records support partial/incomplete data.** Optional business metadata is
  **nullable** — do not make it `NOT NULL` without a strong integrity reason.
- **A row is never discarded solely because optional metadata is missing.** Only rows that violate
  integrity (unparseable, missing a truly required key) are rejected.
- The preview **classifies every row** into: `SENDABLE`, `INCOMPLETE`, `NO_EMAIL`, `INVALID_EMAIL`,
  `DUPLICATE`, `ERROR` (see `docs/requirements.md` for exact definitions).
- **Invalid emails are flagged** (`emailStatus = INVALID`) and **excluded from sending**, but the
  contact is still imported so staff can fix it.
- **Raw source data is preserved** (the original row + import batch id) for troubleshooting/audit.
- Import is **idempotent**: re-importing the same source (matched by normalized email, or a
  `sourceSystem + externalId` reference when available) updates rather than duplicates.

> **Required-fields note (validated decision):** At the **persistence layer**, `email`, `language`,
> and `industry` are **nullable** (so incomplete Hashavshevet data always imports). At the
> **eligibility/completeness layer**, all three are **required for a contact to be a valid target of
> a localized, industry-segmented email campaign**: valid email ⇒ *sendable*, known language ⇒
> *renderable*, known industry ⇒ *segmentable*. This reconciles the brief's data-quality rules with
> its "required" note. **See ADR-0006 — flagged for business validation.**

## Coding Standards

- **TypeScript:** `strict` on. Avoid `any`; prefer precise types, discriminated unions for state,
  and `unknown` + narrowing at boundaries. Export domain types from `domain/`.
- **No magic strings.** Statuses, roles, languages, email/consent states, row classifications, etc.
  are **enums or `as const` union types** in `domain/`, used everywhere. No stray string literals.
- **Validation at the boundary.** Validate and parse all external input (form data, CSV rows, API
  payloads, provider webhooks) into typed domain objects before use. Use one schema library
  consistently (introduce it when the first real input arrives; record the choice).
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
  typed confirmation, live eligibility recompute, idempotent send ledger, environment guard.
- **Input validation** on every external boundary; treat CSV/Excel and provider webhooks as
  untrusted. Verify webhook signatures when the provider supports them.
- **Least privilege** for DB and provider credentials. Log security-relevant actions (auth,
  approvals, sends) to the audit trail.

## Database Rules

- **Prisma migrations are the only way to change schema.** Never hand-edit the database or use
  `db push` against anything but a throwaway local DB. Commit migrations with the code that needs them.
- **Integrity in the database, not just the app:** foreign keys, `UNIQUE` constraints (e.g. one
  active unsubscribe per contact/scope; one send-ledger row per campaign+contact), `CHECK`/enum
  types, and `NOT NULL` **only** for genuinely required fields.
- **Optional business metadata is nullable** (see Domain/Import rules). Required for integrity ≠
  required by business.
- **Indexes** on foreign keys and on columns used for segmentation/eligibility filtering and lookups
  (email, status, language, industry, tag joins).
- **IDs:** use CUIDs/UUIDs (Prisma default `cuid()`), not exposed auto-increment integers.
- **Timestamps:** every table has `createdAt` and `updatedAt`. Append-only audit/event tables keep
  their own immutable `occurredAt`.
- **Transactions** wrap multi-row mutations (import commit, send ledger writes, state transition +
  audit) so they are all-or-nothing.
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
  language, industry, etc.) easy to spot and enrich.

## Testing Expectations

- **Unit** (fast, no I/O): domain logic — the campaign state machine, eligibility rules, segment
  resolution, import row classification, email validation. These encode the invariants; test them
  thoroughly including illegal transitions and edge cases (no email, UNKNOWN language, duplicates).
- **Integration** (with a test Postgres): repositories/services, import commit idempotency, send
  ledger uniqueness, transactional rollback.
- **E2E** (later, key flows): login → import preview → build campaign → approve → schedule/test send.
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
