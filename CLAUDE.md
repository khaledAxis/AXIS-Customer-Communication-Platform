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
| Auth | **Auth.js (NextAuth v5)** `next-auth@5.0.0-beta.32` | Credentials only; JWT sessions; server-enforced RBAC (ADR-0023) |
| Passwords | **Argon2id** via `@node-rs/argon2` | OWASP baseline; prebuilt native binding, `serverExternalPackages` |
| Container | **Docker** | For Postgres locally, and app image later |
| Email (TEST) | **Gmail SMTP** via `nodemailer` | `smtp.gmail.com:465`, implicit TLS, Google **App Password**; behind the `EmailProvider` port (ADR-0014). Replies go to `NEWSLETTER_REPLY_TO` (ADR-0019) |
| Email (production) | **Resend** via the `resend` SDK | Behind the SEPARATE `ProductionEmailProvider` port (ADR-0024/0025). Sends as `newsletter@axis-gps.com`. `DisabledProductionEmailProvider` (whose `send()` **throws**) is still the fallback whenever configuration is incomplete; **customer delivery remains LOCKED** |
| Public unsubscribe | **Opaque 32-byte token**, SHA-256 stored (ADR-0024) | `/unsubscribe/<token>`; GET confirms, POST records. Footer-only link, **no `List-Unsubscribe` header** |
| CRM source | **Monday.com** (GraphQL API + webhooks) | **Source of truth**; platform is a **read-only projection** (ADR-0007) via a query-only `CrmSource` port — implemented in ADR-0017 |
| Send safety | **Send-mode gate** (`TEST` default / `PRODUCTION`) | Server-side safe-send redirect; going live is an explicit admin action (ADR-0008) |
| Email HTML | **One canonical renderer** in `domain/email` | Table-based + inline styles; preview and sender share it (ADR-0011). No email-template library |
| Rich text | **Restricted markup rendered server-side** | No stored client HTML; XSS-safe by construction. No WYSIWYG dependency (ADR-0012) |
| Media | **`MediaStore` port**; **Cloudinary** hosted, local disk fallback | Selected by `MEDIA_PROVIDER`; `CLOUDINARY_URL` is a **secret**; never in `public/`, never in PostgreSQL (ADR-0012/0016) |
| Content sources | **RSS / Atom feeds** via a purpose-built reader | SSRF-guarded fetcher; **no crawler, no XML dependency, no AI** (ADR-0026) |
| Jobs | Deferred | In-process scheduling first; **Redis/BullMQ only when justified** (see ADR-0005) |

**Not yet installed, and must not be added until its milestone has a concrete need:** Redis, BullMQ,
a component library. Adding one early is a defect. (Prisma, Auth.js, a Monday API client and the
Resend SDK are now installed and in use — the last selected in ADR-0025.)

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
│   │   ├── auth/            # Password policy, capability matrix, credential parsing (ADR-0023)
│   │   ├── delivery/        # Dispatch vetoes, delivery state machine, provider events (ADR-0024),
│   │   │                     #   pilot allowlist + domain-auth interpretation (ADR-0025)
│   │   ├── unsubscribe/     # Unsubscribe token + public-URL policy (ADR-0024)
│   │   ├── campaign/         # Production approval hash + send-readiness evaluator (ADR-0022)
│   │   ├── content/         # Source-URL (SSRF) policy, feed reader, article identity,
│   │   │                     #   automation occurrences (ADR-0026)
│   │   └── segment/          # Segment rule catalogue + validation (ADR-0018)
│   ├── server/               # Server-only: services, data access, integrations, auth
│   │   ├── services/         # Use-cases / application layer (orchestrate domain + persistence)
│   │   ├── auth/             # Auth.js wiring, Argon2id hashing, session DAL (ADR-0023)
│   │   ├── db/               # Prisma client + repositories (added at DB milestone)
│   │   ├── media/            # MediaStore port + local-disk implementation (dev)
│   │   └── integrations/     # External adapters behind interfaces — Monday CRM, email
│   │                         #   providers, and the SSRF-guarded feed fetcher (ADR-0026)
│   ├── lib/                  # Framework-agnostic shared utilities (validation, formatting)
│   └── ui/                   # Reusable presentational components (RTL-aware)
├── prisma/                   # schema.prisma + migrations (added at DB milestone)
├── var/media/                # Local DEV image uploads — git-ignored, replaced by object storage
├── src/proxy.ts              # Next 16 proxy (was `middleware`) — anonymous redirect to /login
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
- **A DRAFT audience snapshot is planning, not delivery (ADR-0018):** "Record this audience" writes
  only `CampaignAudienceSnapshot` + `CampaignAudienceExclusion`, replaces any previous snapshot for
  that campaign, and creates **no** `CampaignRecipient`/`CampaignEvent`. The authoritative send-time
  snapshot and the delivery ledger belong to the send workflow.
- **A FINAL audience snapshot is preparation, not delivery (ADR-0022):** "Prepare final audience"
  writes only `CampaignFinalAudience` + `CampaignFinalAudienceDestination` +
  `CampaignFinalAudienceExclusion`. These rows are **append-only and never updated** — preparing
  again creates a NEW snapshot, and the newest is the current one. A destination is **not** a
  `CampaignRecipient`: that table means delivery happened or will, and writing to it early would
  make "was this sent?" unanswerable.
- **Production customer sending is NOT implemented.** The readiness checklist's infrastructure check
  is hard-wired `BLOCKED`, there is no send action or route handler for it, and the only
  `ProductionEmailProvider` implementation **throws** when asked to send — never a quiet no-op that
  could be mistaken for a delivery. `PRODUCTION_DELIVERY_ENABLED` lives in the environment, not the
  database, so no UI writes it and no role — including ADMIN — can flip it from a browser.
- **A delivery ledger is preparation, not delivery (ADR-0024).** `CampaignRecipient.finalAudienceId`
  is **required**: a destination with no approved provenance is one nobody authorized. Rows are
  created `PENDING` by an explicit dry-run action that demands a signed-in actor, a NON-STALE final
  audience, a VALID approval and satisfied four-eyes. No service function accepts an address, so
  "send to this person as well" is unrepresentable.
- **High-authority vetoes are re-read immediately before submission.** `decideDispatch` re-checks
  unsubscribe, suppression, address validity, consent and language — an approved audience is a
  statement about the past, and somebody may have opted out since. It uses the same
  `ExclusionReason` vocabulary and can only ever REMOVE a recipient, never add one.
- **`ACCEPTED` is not `DELIVERED`, and `UNCERTAIN` is never auto-retried.** Only a provider event
  may claim delivery, and the state machine has no transition from `UNCERTAIN` back to `READY` or
  `SENDING`, so no retry loop can duplicate a real customer email.
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
  `cc`, `bcc` or `replyTo`**, and `to` is a single string. The sender **and the reply address** are
  adapter configuration, never message fields. `assertSafeTestEnvelope` re-validates in the service
  **and** again inside the adapter, still refusing (never trimming) any caller-supplied `replyTo`,
  `cc` or `bcc` — the audience cannot widen.
- **Approval is bound to a SHA-256 of the exact rendered message** (campaign, mode, sender, sender
  display name, reply address, recipient, subject, preheader, ordered content, HTML, text). At send time the newsletter is **re-rendered and
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

### No-reply newsletter behaviour (ADR-0019)

- **Replies go to a no-reply address, not to the sending mailbox.** Every newsletter carries
  `Reply-To: noreply@axis-gps.com` (`NEWSLETTER_REPLY_TO`). The authenticated sender is unchanged —
  Gmail sends as the account that signed in; only the reply destination moves.
- **Central configuration, never per newsletter.** There is no UI input, no form field, and no
  service parameter for it. `getSenderIdentity()` in `server/integrations/email` is the single
  resolution point, read by BOTH the hashing service and the SMTP adapter, so what is approved and
  what is sent cannot diverge. A caller-supplied `replyTo` is still refused outright.
- **Validated for shape, and refused rather than repaired:** exactly one plain address — no array,
  no comma/semicolon list, no `Name <addr>` form, no control character. Injection is checked on the
  **raw** value before trimming, because trimming a trailing newline first would hide the attack. A
  malformed value makes test sending **unavailable**; it never silently falls back.
- **Reply-To and the sender display name are part of the approval hash.** Changing either
  invalidates an existing approval — the user must preview, approve, and send again. A stored
  approval also records `replyToEmail` as a second, independent gate.
- **From shows `AXIS Advanced Mapping Solutions <axisgpscana@gmail.com>`.** The display name is a
  constant and is injection-checked like an address.
- **Unsubscribe stays exactly as it is: footer-only.** No `List-Unsubscribe` header, no
  `List-Unsubscribe-Post`, no Gmail one-click unsubscribe, and no unsubscribe control near the
  sender. Tests assert their absence, so adding them later must be a deliberate act.
- **The FOOTER IS UNCHANGED by ADR-0024 — only the href moved.** One small link, same place, same
  prominence. A production message carries a per-recipient token; a SAFE TEST or preview carries a
  CONSTANT, inert token, because the ADR-0013 approval hash covers the HTML and a per-render token
  would make every approval unmatched. The inert link unsubscribes nobody, so a test email can
  never touch a customer.
- The unsubscribe href obeys the SAME deliverability rule as images (ADR-0015): a URL that only
  resolves on the sending machine falls back to the existing placeholder rather than shipping a
  dead link.
- **The email client's Reply button cannot be removed** — it belongs to Gmail/Outlook. What the
  platform controls is where the reply is addressed. The footer keeps the real contact address
  (`info@axis-gps.com`) as the way to reach AXIS, and the send panel states plainly that replies are
  not monitored.

### Production provider, domain authentication & the internal pilot (ADR-0025)

- **Resend is the production provider, behind the existing port.**
  `server/integrations/email/resendProductionEmailProvider.ts` is the ONLY file that imports the
  Resend SDK. Domain, services and UI depend on `ProductionEmailProvider`. The registry resolves to
  Resend only when `PRODUCTION_EMAIL_PROVIDER=resend` **and** `RESEND_API_KEY` is present; anything
  else falls back to `DisabledProductionEmailProvider`, which throws. A half-configured vendor must
  degrade to "cannot send", never to "sends somewhere unexpected".
- **Selecting a vendor is not enabling delivery.** `PRODUCTION_DELIVERY_ENABLED` stays `false`, is
  read from the environment, is not in the database, and **no ADMIN UI can set it**.
  `dispatchCampaign` refuses on that switch alone, before reading a single row, and deliberately
  **never reads `PROVIDER_PILOT_ENABLED`** — enabling the pilot must grant nothing on that path.
- **Accepted ≠ delivered, end to end.** A provider id means ACCEPTED. Resend's `email.sent` maps to
  `ProviderEventType.ACCEPTED`, never to anything called "sent"; only `email.delivered` may produce
  `DELIVERED`. A broken connection is `UNCERTAIN`, never `FAILED`, and is **never auto-retried**.
- **Domain state is READ from the provider, never assumed.** `fetchDomainStatus` lists and reads; it
  creates nothing, edits no DNS, sends nothing. The answer is stored as `ProviderDomainSnapshot` with
  its timestamp, and "not checked" is displayed differently from "not verified".
  `checkConfiguration()` stays network-free. **DMARC is always `UNKNOWN`** — AXIS publishes it, no
  provider can confirm it, and this platform performs no DNS lookups. Guidance is staged
  (`p=none` → `quarantine` → `reject`); **never start at `p=reject`**. A domain may publish exactly
  **one** SPF record, so a provider include is MERGED before the terminal `all`, never duplicated.
  DNS values are displayed, never invented and never applied.
- **Webhooks are verified BEFORE the body is read.** `/api/webhooks/resend` reads the raw text (never
  `request.json()` — re-serialising changes the signed bytes), verifies via the adapter, and only
  then acts. Unverifiable ⇒ `401`, no state change, and a body containing **no** recipient, campaign
  or reason. A verified duplicate returns `200` — anything else makes the provider retry forever.
  De-duplication checks **both** `CampaignEvent` and `SuppressionEvent`, because an event about an
  address with no ledger row writes only a suppression.
- **The internal PROVIDER PILOT is one email to one hard-coded address.** Sender
  `AXIS Advanced Mapping Solutions <newsletter@axis-gps.com>`, recipient `khaled-s@axis-gps.com`,
  subject prefixed `[AXIS PROVIDER PILOT]` (idempotently). The audience is **unrepresentable**: no
  `from`/`cc`/`bcc`/`replyTo` field exists and `to` is a single string. `assertSafePilotEnvelope`
  **refuses — never trims** — arrays, comma/semicolon lists, control characters, any other recipient
  and any other sender; it runs in the service **and again inside the adapter** before the network
  call. Gated by `PROVIDER_PILOT_ENABLED` **and** a provider-verified domain. Approval is hash-bound
  and single-use (`UNIQUE CampaignTestSend.approvalId`). It writes **no** `CampaignRecipient`,
  `CampaignEvent` or `CampaignFinalAudience`. **A human triggers it** — no scheduler, no worker, and
  no test may send one.
- **Channels cannot substitute for one another.** `SendChannel` (`SAFE_TEST_GMAIL` |
  `PROVIDER_PILOT`) is stored on `CampaignTestApproval` and `CampaignTestSend`, and every query is
  scoped to it. **SAFE TEST must not call Resend; the pilot must not call Gmail** — asserted against
  the source, not merely intended.
- **The API key is never printed, logged, persisted, returned or committed.** `.env.local` only,
  never `.env.example`, never a chat message. Provider errors are not echoed: they can carry the
  request, and the request carries the key.
- **Never expose the development machine to the internet** for webhooks — no port forwarding, no
  tunnel. Deploy to an internal HTTPS host and set `PUBLIC_APP_URL`. Until then delivery events do
  not arrive; that is reported, not hidden.
- **Unsubscribe appearance is unchanged on this path too:** one small footer link. No
  `List-Unsubscribe`, no `List-Unsubscribe-Post`, no Gmail one-click control.

### Content sources, review inbox & assisted automation (ADR-0026)

- **Feeds only — this is NOT a crawler.** v1 reads declared RSS 2.0 / Atom 1.0 feeds plus a
  `MANUAL_EXTERNAL` kind added by hand. There is no crawl depth, no link-following, no
  link-discovery toggle and no HTML scraping, and their absence IS the control.
- **SSRF defence is two halves, both required.** `domain/content/sourceUrl.ts` (pure) allows only
  public `http(s)`, no credentials, ports 80/443, and refuses loopback, RFC1918, link-local, CGNAT,
  private IPv6 **including IPv4-mapped forms** (`::ffff:127.0.0.1`), internal hostnames, bare
  labels, and cloud metadata by address AND name. `server/integrations/content/feedFetcher.ts` is
  the **only** place a source is fetched: it resolves DNS and re-checks EVERY resolved address,
  follows redirects **manually one hop at a time re-validating each hop** (`redirect: "follow"`
  would hand the decision to undici), caps the body **while streaming**, times out, checks the
  content type, and sends no cookies, no `Authorization` and no AXIS identity.
- **The feed reader refuses a DOCTYPE or ENTITY declaration outright** and has no concept of
  resolving one, so XXE and entity-expansion bombs have nothing to attack. A malformed feed yields
  fewer items, never an exception.
- **Collected is never usable.** Every ingested item is created `PENDING_REVIEW`; no branch, flag
  or configuration creates one `APPROVED`. Only a signed-in person approves or rejects, and both
  write an audit row naming them.
- **Dedup is the database, not a check.** Identity is `(source, externalId)` or
  `(source, normalizedUrl)`, both UNIQUE. Normalization drops scheme, `www.`, default port,
  fragment and campaign tracking parameters and sorts the rest, but **keeps** parameters like
  `?id=12` which often ARE the article. It **never merges on resemblance** — similar titles are
  not a signal, and identity is scoped per source.
- **Source metadata and AXIS editorial copy are separately owned.** Mirrored: `title`, `summary`,
  `author`, `externalUrl`, `publishedAt`. Local: `axisHeadline`, `axisSummary`, `ctaLabel`,
  `ctaUrl`, `internalNote`. `saveEditorial`'s update payload holds ONLY the second set, so it
  cannot rewrite the publisher or approve anything — a re-collection refreshes the source fields
  and never destroys the words a colleague wrote.
- **Only a title, a short source-supplied excerpt and a link are stored** — never the article.
  Atom `<summary>` is preferred over `<content>` (often the whole piece), excerpts are truncated at
  ingestion, and the newsletter links to the original.
- **Adding a SOURCE is ADMIN** (`MANAGE_CONTENT_SOURCES`) because a source is a URL this server
  will fetch. Reviewing ARTICLES is ordinary MANAGER work. This amends ADR-0023's "exactly one
  admin capability" note; the invariant it protected is now tested directly — **nothing an
  administrator holds alone can approve, send, or choose who receives an email**.
- **Automation prepares a DRAFT and can do nothing else.** It drafts only from content a person
  ALREADY approved, so a new automation's first run legitimately reports `NO_CONTENT`. The draft
  has **no segment**, no final audience, no `CampaignRecipient` and no approval. A test asserts
  against the source that `automationService.ts` names neither provider registry, nor
  `dispatchCampaign`, nor `campaignRecipient`.
- **An occurrence happens once** (`@@unique([automationId, scheduledFor])`) — a double click, a
  retry or two workers collapse into ONE run at the database. A **missed occurrence stays due**,
  deliberately the opposite of ADR-0010's rule for a scheduled SEND.
- **"Nothing new" is `NO_CONTENT`, stated in a plain sentence** — never rendered as an error.
  A paused automation does not run, leaves no run row, and carries no next occurrence.
- **One failing source is one failing line:** each source is fetched and committed independently
  and the batch is `PARTIAL`. Diagnostics are friendly text — never a stack trace, and never an
  internal address, even in a run log.
- **External images are imported only on explicit request**, with the same guards as an upload
  (public URL, size cap, magic-byte sniffing, SVG refused). Hot-linking breaks when a publisher
  reorganises their CDN; importing everything automatically would be rude and expensive.
- **No AI.** Subject/preheader suggestions are mechanical string operations. Adding a generator
  needs its own ADR, and its output would be DRAFT text requiring human review.
- **No live provider can be constructed under the test runner.** A developer machine holds real
  credentials in `.env.local` and the suite reads the same environment, so BOTH registries refuse
  a network-capable adapter under `VITEST`/`NODE_ENV=test`; the SAFE TEST port resolves to a
  transport that throws.

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

### Segmentation (ADR-0018)

- **A segment stores validated rules as JSON — never SQL, never executable code.** `Segment.criteria`
  is re-parsed and re-validated on **every read** (a stored row is untrusted input). Only fields and
  operators declared in `domain/segment/segmentFields.ts` exist, and only the Prisma clauses written
  in `server/db/repositories/segmentQuery.ts` can be produced.
- **v1 boolean shape is deliberately limited:** top level is always ALL; OR lives inside groups; one
  level of nesting; **a group may not mix scopes** (company / contact / product / email settings).
  Mixed-scope OR has no single clear meaning and is refused, not reinterpreted.
- **Matching semantics:** company and product conditions select companies (AND-ed product conditions
  must be satisfied by **one** owned product); contact conditions select contacts, which must also
  belong to a matching company when company conditions exist; email-settings conditions filter the
  resolved address. A segment chooses which address kinds to include — the **accounting address has
  no code path** and can never be selected.
- **Two stages, never collapsed:** CRM MATCHING → COMMUNICATION ELIGIBILITY. Resolution reuses
  `domain/audience/resolveAudience` + `domain/eligibility` — there is exactly one eligibility engine.
  A record may match a segment and still be excluded from delivery; both numbers are reported.
- **Failing an email-settings condition is *not* an exclusion** — it means the record was never in
  the segment. Exclusions are produced only by eligibility, only for records the segment selected.
- **Every exclusion is explainable:** grouped by reason with a friendly label and a remedy, plus a
  per-address list. Raw reason codes are never shown. Matched-company/contact counts are computed
  **after** email-settings filtering — reporting "1,215 matched" for a segment that selects nobody is
  true and misleading.
- **Membership is dynamic:** a segment stores the definition, never a member list, and is re-resolved
  on every preview and (later) at send time.
- **A preview writes nothing** — no `CampaignRecipient`, no `CampaignEvent`, no provider call. A test
  asserts the audience code contains no mail-transport reference at all.
- Lookup conditions (classification, industry, product type) store the Monday **label**, not a
  database id.
- Contacts missing segmentation metadata are simply not matched by those criteria — they are not
  errors and must still exist and be enrichable.

### Language (assignment: ADR-0020)

- Language is an explicit enum: **`HE`, `AR`, `UNKNOWN`**, held on **`CommunicationAddress`** (per
  normalized email), not on the contact. Missing language is **`UNKNOWN`**, never silently Hebrew and
  never inferred.
- **Only a person sets it.** Monday has no language column, so every value is a deliberate human
  action, made through `/communication` (or the customer page) and **audited** with
  `COMMUNICATION_LANGUAGE_CHANGED` (from-state, to-state, actor, batch id for bulk).
- **Never inferred** — not from a name, an email domain, a company, or CRM presence. A suggestion
  mechanism is deliberately absent: the mirrored data carries no signal honest enough to base one on.
- **The editable unit is the address, not the CRM record.** Several company/contact records commonly
  share one address and therefore one profile; the UI shows every contributing record and says so.
- **Language only.** The assignment path has no consent, `emailStatus`, unsubscribe or suppression
  field anywhere in the parser, service or action — those cannot change here even by accident.
  **Assigning a language never implies consent** (a legal decision, not a data-quality one).
- Bulk changes are bounded (2,000 per operation) and require explicit confirmation naming the count.
- A localized campaign targets a language. **Destinations whose `CommunicationAddress.language` is
  `UNKNOWN` are excluded** from a localized send unless an admin overrides for that campaign. Content
  and layout must render **RTL** for both Hebrew and Arabic.

### Consent (assignment: ADR-0021)

- Consent is an explicit enum: **`UNKNOWN`, `GRANTED`, `DENIED`**, held on
  **`CommunicationAddress`** (per normalized email), locally owned and **sync-immune**. Monday has
  no consent column, so every value is a deliberate human act.
- **Never inferred** — not from a language, not from a name, not from a company, not from a CRM
  record existing. **Assigning a language never implies consent**, and the two paths physically
  cannot reach each other: `setLanguage`'s update payload holds `language` and nothing else,
  `setConsent`'s holds consent + evidence and nothing else.
- **`GRANTED` requires evidence; refusing does not.** Approving needs an explicit confirmation, a
  documented **basis** (`ConsentSource`) and an **effective date** (never in the future);
  `OTHER_DOCUMENTED_BASIS` additionally requires a note. `DENIED`/`UNKNOWN` need only the
  confirmation — refusing to email someone is never the risky direction. Moving `DENIED → GRANTED`
  therefore demands fresh evidence, and the basis is **cleared** when consent leaves `GRANTED`.
- **Refused, not repaired:** an unrecognised basis is never mapped to "Other", a missing basis is
  never defaulted, and an absent confirmation checkbox is never read as `true`.
- **The labels are administrative metadata, not a legal determination.** The platform records what a
  person asserted and who asserted it; choosing an adequate basis is the operator's responsibility,
  and no UI text may suggest the software decided.
- **`UNKNOWN` is preserved exactly as it was:** eligibility excludes only `DENIED`, so `UNKNOWN`
  does not block a send — and is never silently upgraded to `GRANTED`. `evaluateEligibility` has an
  **opt-in** `requireExplicitConsent` flag (default `false`) producing
  `ExclusionReason.CONSENT_NOT_CONFIRMED`; readiness reports the unconfirmed count as a **WARNING**.
  Turning it on for production needs its own ADR.
- **Consent never overrides the stronger facts.** `GRANTED` + unsubscribed ⇒ **INELIGIBLE**. The
  same holds for suppression, `emailStatus = INVALID`, archived sources and inactive companies. The
  consent service cannot reach `Unsubscribe` or `Suppression` — they are not in its payload.
- **Bulk is bounded and explicit:** ≤ 2,000 addresses per operation, no "grant consent to everyone"
  control, nothing pre-selects all addresses, and approving asks twice with the count named
  ("You are marking 47 communication addresses as approved for communication.").
- Every change writes an append-only `AuditLog` row (`COMMUNICATION_CONSENT_CHANGED`) with
  from-state, to-state, actor, basis, effective date, note and bulk batch id. Audit rows are never
  updated — a later change adds a row.

### Final audience & send readiness (ADR-0022)

- **Two audience concepts, never merged.** `CampaignAudienceSnapshot` is DRAFT planning: replaced on
  every recompute. `CampaignFinalAudience` is frozen at a moment, **written once and never
  updated**, and an approval points at one specific row.
- **One logical preparation per intent (ADR-0023).** `@@unique([campaignId, preparationKey])` makes
  a double click, a retried POST or five concurrent requests collapse into ONE snapshot; the losers
  read the winner's figures back rather than assuming them. A later, deliberate preparation carries
  a fresh token and still creates a new snapshot — append-only history is preserved, never weakened.
- **Readiness skips the full re-resolution only when it is provably safe (ADR-0023).**
  `resolutionWatermark` fingerprints every table the resolution reads. A match proves nothing
  relevant changed; any mismatch, or an empty value on an older row, re-resolves in full. It is a
  proof about INPUTS, never a cache of a conclusion, so it can only fail towards more work.
- **Staleness is a comparison, not a stored flag.** Readiness always re-resolves the audience live,
  re-hashes it with `computeAudienceHash`, and compares. A CRM resync, a language or consent change,
  an unsubscribe, a suppression, an edited segment or a changed campaign language all move a hashed
  input, so all of them make a snapshot stale automatically — nothing has to remember to invalidate
  anything. A stale snapshot is **BLOCKED**, never a warning.
- **Friendly CRM names are deliberately NOT hashed** — a company renamed in Monday must not
  invalidate an approval, because the same people still receive the same email.
- **Production approval extends the ADR-0013 model with the audience.** `CampaignProductionApproval`
  binds a SHA-256 over subject, preheader, HTML, text, ordered content ids, image URLs, campaign
  language, sender address, sender display name, reply-to, **final audience id and audience hash**.
  Everything is re-derived at readiness time; a client-supplied `approved=true` is never trusted.
  Preparing a new final audience revokes any open approval.
- **Four-eyes is ENFORCED (ADR-0023).** `evaluateFourEyes` requires an authenticated approver, a
  MANAGER/ADMIN role, and `approverId !== createdById` — **administrators are not exempt for a
  production send**. `approveForProduction` derives the approver from the session and **refuses**
  a self-approval; the disabled button is a courtesy, the service is the control. Approvals
  record `authenticatedActor = true`; rows written before authentication existed keep `false` and
  can never retroactively satisfy the rule. **Never fake a second employee and never soften this.**
- **Readiness is one deterministic pure function** (`domain/campaign/sendReadiness.ts`) producing
  `READY` / `WARNING` / `BLOCKED` per check across CONTENT, AUDIENCE, COMMUNICATION, APPROVAL and
  INFRASTRUCTURE. The COMMUNICATION group **states** the unsubscribe/suppression/address/language
  posture rather than re-deriving it — a second eligibility engine is a defect.
- **Nothing disappears silently.** Matched CRM records, unique addresses, duplicates collapsed,
  eligible, excluded and a friendly reason per exclusion are all shown, and a truncated snapshot
  (> 20,000 rows) is reported as a WARNING rather than hidden.
- **Accounting addresses have no code path** and can never appear in an audience, eligible or
  excluded.

### Public unsubscribe (ADR-0024)

- **The token carries NO DATA.** 32 CSPRNG bytes, base64url; only its SHA-256 is stored, exactly
  like a password. Everything the endpoint needs lives on the row it matches, so there is no
  payload to forge, no identifier to read, and a modified token resolves to nothing at all — never
  to a different address. Never put an address id, contact id, company id, Monday id or email in
  the URL.
- **GET resolves and changes nothing; POST records.** Mail clients prefetch links and security
  appliances open every URL in a message. The confirmation step is ACCIDENT-SAFETY, not CSRF
  protection — there is no session to hijack, and anyone who can forge the request already holds
  the token.
- **Every failure is the same sentence.** Unknown, revoked, malformed and throttled all render
  identically, and the page never displays the address it resolved. The endpoint must never become
  an oracle for which addresses AXIS holds.
- **Only INVALID attempts are throttled**, so a genuine recipient is never refused. No CAPTCHA.
- Unsubscribe is **GLOBAL, append-only and idempotent** (`@@unique([normalizedEmail, scope])`).
  It beats consent, language, segment and CRM source. The address, its profile and its provenance
  are never deleted, and there is deliberately **no public re-subscribe**.
- The audit row carries `actorUserId: null` and `actor: "PUBLIC_RECIPIENT"` — a recipient is not
  an AXIS employee, and no colleague's name may be attached to what a customer did.
- **`PUBLIC_APP_URL` is the only source of the link's origin.** Never the `Host` header, never the
  LAN address the sender happened to use. HTTPS + a publicly-reachable host are required for
  production; `http://localhost` is development-only and keeps production readiness BLOCKED.

### Bounce & complaint handling (ADR-0024)

- **Hard bounce** ⇒ suppress **and** set `emailStatus = INVALID` (the mailbox does not exist, and
  staff must see the data-quality problem). **Complaint** ⇒ suppress and **do NOT** mark invalid —
  the mailbox works, the person simply does not want the mail. **Soft bounce** ⇒ nothing.
- Both suppressions **outrank a GRANTED consent**, and nothing may silently re-enable an address.
- Ingestion is idempotent by `providerEventId`; every provider re-delivers webhooks.
- **No public webhook route exists yet.** An endpoint accepting unsigned events would let anyone
  suppress AXIS customers. Signature verification belongs to the vendor adapter, and the route
  appears with the vendor.

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
    must NEVER overwrite these:** `emailStatus`, **`language`**, `consentStatus` and its evidence
    (`consentSource`, `consentNote`, `consentEffectiveAt`, `consentRecordedAt`,
    `consentRecordedById`, `consentBatchId`). (There is **no** Monday language/consent field; both
    default `UNKNOWN`, never inferred.)
  - **Locally-owned, other:** `Unsubscribe`, `Suppression`/`SuppressionEvent`, `Campaign`,
    `CampaignRecipient`, `CampaignRecipientSource`, `CampaignEvent`, `CampaignTestSend`,
    `CampaignAudienceSnapshot`/`Exclusion`, `CampaignFinalAudience` (+ its destinations and
    exclusions), `CampaignProductionApproval`, `AuditLog`, `Segment`, archive flags, send-mode
    config.
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
- **Anti-mass-archival guard (ADR-0017):** a truncated, filtered or failed Monday response is
  indistinguishable from "everything was deleted". A sync that would archive more than **20% of a
  board's currently active records** is **refused**: nothing is archived, the `SyncRun` is marked
  `PARTIAL`, and the reason is recorded. The denominator is the **active** count — measuring against
  all rows hides a catastrophic archival behind a small ratio. A board-level read failure marks the
  run `FAILED` and archives **nothing**.
- **Sync freshness:** store `lastSyncedAt` per board/record. For v1, stale data raises a **visible UI
  warning**; it does **not** auto-block sending.

### CRM synchronization (incomplete data is the norm)

- Sync is **idempotent**: upsert keyed on `(mondayBoardId, mondayItemId)` inside a transaction.
  Monday `board_relation` columns return **`null` for `text` and `value`** on API 2024-10 — linked
  ids come only from `... on BoardRelationValue { linked_item_ids }`. Reading the generic fields
  yields zero relationships **silently**, with no error (ADR-0017).
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
- **Authentication (ADR-0023):** Auth.js v5, Credentials provider, JWT sessions. All non-public
  routes/actions require a valid session. The **session DAL** (`server/auth/session.ts`) is the
  security boundary: it re-reads the `User` row on every request, so a deactivation or a role
  change takes effect on the next click. `src/proxy.ts` only redirects anonymous traffic early —
  it checks for a cookie's existence and is **never** the guard.
- **Passwords:** **Argon2id** only (`server/auth/password.ts`). Never plaintext, never reversible,
  never logged, never returned to a client, never selected into a type that reaches the browser.
  There is no `decrypt` and there must never be one.
- **No public registration.** No sign-up page, action or route exists. Accounts are created only
  at `/admin/users` by an `ADMIN`. The first administrator is created once at `/setup`, which
  closes itself permanently — the gate is re-checked **inside** the creating transaction.
- **Authorization:** one capability matrix in `domain/auth/authorization.ts`, **enforced
  server-side** by `requireCapability` in every service — not merely by hiding UI. A service
  never re-derives a rule from a role string. MANAGER runs the communication business; ADMIN
  adds only INFRASTRUCTURE capabilities — `MANAGE_USERS` (ADR-0023) and
  `MANAGE_CONTENT_SOURCES` (ADR-0026, a URL this server will fetch). **Nothing an administrator
  holds alone can approve, send, or choose who receives an email**, and a test asserts it.
- **The actor is always the session.** No service function takes an actor, approver or user id
  as a parameter, and no parsed input shape has such a field, so a forged form value has nothing
  to attach to. Deactivated and system accounts hold **no** capability whatever their role.
- **Mass-mail protection** (see Domain Rules → Sending safety) is a security control, not just UX:
  the server-side `SEND_MODE` safe-send gate (`TEST` default), typed confirmation, live eligibility
  recompute, idempotent send ledger, and environment guard. Going to `PRODUCTION` is an explicit,
  audited admin action — never automatic.
- **Input validation** on every external boundary; treat **Monday API responses/webhooks**, provider
  webhooks, and optional CSV/Excel uploads as **untrusted**. Verify webhook signatures (Monday
  signing secret + challenge handshake; email-provider signatures) before processing.
- **Public unsubscribe endpoint** (implemented, ADR-0024): no login, an unguessable data-free token,
  no enumerable identifiers, identical messages on every failure, and throttling that counts only
  INVALID attempts so a real recipient is never blocked. `/unsubscribe` is listed public in
  `src/proxy.ts` alongside `/login`, `/setup`, `/api/auth` and `/api/media`.
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
- **Sign in / sign out:** `/login` is the only way in; the shell shows the signed-in person, their
  role and a **Sign out** control on every page. Anonymous screens (`/login`, `/setup`) render
  without navigation. A sign-in failure never reveals whether an address exists.
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
- **Consent labels are the only form staff see:** "Not confirmed" / "Approved for communication" /
  "Do not send". Raw enum names never reach a screen, and neither do raw exclusion reason codes.
- **Delivery infrastructure** is shown on the readiness page as facts, never assumptions: production
  sender, domain authentication (SPF/DKIM/DMARC), public unsubscribe, production provider, and
  production delivery — each READY or NOT READY. A dry-run ledger control is labelled
  **"Prepare delivery records — NO EMAIL WILL BE SENT"** and rows read **PREPARED / NOT SENT**.
- **Send readiness (`/newsletters/[id]/readiness`)** shows every check as READY / WARNING / BLOCKED,
  the full audience funnel, the exclusion breakdown, and inspectable lists of eligible addresses and
  exclusions. The production control is rendered **disabled** with the reason
  *"Production customer sending has not been enabled."*

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
- **Mandatory consent & readiness tests (ADR-0021 / ADR-0022):**
  - consent survives a Monday resync, and a language change never touches it;
  - `GRANTED` does not override unsubscribe, suppression or an invalid address;
  - `DENIED` excludes immediately, without needing an unsubscribe;
  - a malformed consent update is refused and writes nothing;
  - a bulk operation changes only the selected rows;
  - a frozen final audience is never edited — preparing again writes a new snapshot;
  - a CRM, language, consent, unsubscribe, suppression, segment or campaign-language change makes a
    snapshot **stale**;
  - a content, image, subject or audience change makes an approval **invalid**;
  - `CampaignRecipient` count stays **zero**, production stays **BLOCKED**, and the SAFE TEST
    workflow keeps working independently.
- **Mandatory authentication tests (ADR-0023):**
  - valid credentials succeed; a wrong password, an unknown address and a deactivated account all
    fail, and the caller cannot tell them apart;
  - a system account (the retired development stand-in) can never sign in or approve;
  - passwords are Argon2id-hashed, salted, never stored in plaintext and never returned to a
    client;
  - an unauthenticated server action is refused;
  - a MANAGER cannot administer users; an ADMIN can;
  - the actor comes from the session and a browser-supplied actor id is ignored;
  - a creator cannot approve their own campaign, **including an ADMIN**; a different
    MANAGER/ADMIN can;
  - a double click, a retry and five concurrent preparations yield ONE final audience;
  - the readiness watermark changes for every security-relevant edit, and the shortcut never
    bypasses a permission check.
- **Mandatory unsubscribe & delivery tests (ADR-0024):**
  - a modified, random or malformed token is refused and leaks nothing; A's token cannot
    unsubscribe B;
  - GET does not unsubscribe; a confirmed POST does; repeats are idempotent;
  - an unsubscribe excludes the address immediately, beats GRANTED consent and a matching
    language, makes the final audience STALE and the approval NOT READY;
  - the SAFE TEST link unsubscribes nobody; the footer has exactly ONE link and no
    `List-Unsubscribe` header is emitted;
  - a recipient is unique per (campaign, normalized email), always references a final audience,
    and can never be an accounting address;
  - a stale audience, an invalid approval, a self-approval or missing four-eyes all BLOCK ledger
    preparation;
  - the dry run makes **zero** provider calls, the disabled adapter **throws**, `ACCEPTED` is
    distinct from `DELIVERED`, and `UNCERTAIN` is never picked up again;
  - a hard bounce suppresses and invalidates; a complaint suppresses without invalidating; the
    same provider event ingests once; an unverifiable webhook is refused.
- **Mandatory content-source & automation tests (ADR-0026):**
  - a private, loopback, metadata, non-HTTP or credentialed source URL is refused, and a
    redirect to a private target fails the source without ingesting anything;
  - a DOCTYPE/ENTITY feed is refused; an HTML page is reported as "not a feed";
  - re-polling the same feed creates nothing new; tracking parameters do not create a
    duplicate; two different articles with the same title are NOT merged;
  - one failing source leaves the others working and the batch `PARTIAL`;
  - ingested content is `PENDING_REVIEW`, and rejected or unreviewed content cannot enter a
    draft even when its id is supplied directly;
  - AXIS editorial copy is stored separately and survives a re-collection;
  - a draft created from content has ordered items, the first as hero, **no segment**, no final
    audience and **zero** `CampaignRecipient`;
  - a paused automation does not run and leaves no run row; one occurrence yields ONE run
    under concurrency; "nothing new" is `NO_CONTENT`, not a failure;
  - a MANAGER cannot add a source; an ADMIN can; every action is audited to the real actor;
  - **no live email provider can be constructed under the test runner** (both ports).
- **Mandatory password-change tests (ADR-0024):** an administrator-issued password grants NO
  capability, can still sign in, and is replaceable exactly once — after which the old password
  fails, the new one works, the flag clears, and the audit row records the change without the
  password.
- **Integration suites sign in** through `tests/support/actor.ts`. `setActorForTesting` throws
  outside the test runner — never route production identity through it.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
