# Architecture Decision Records (ADRs)

This directory records **significant** architectural and technical decisions — the ones that shape
structure, dependencies, or important trade-offs. Trivial choices do not get an ADR.

## What is an ADR?

A short document capturing one decision: its **context**, the **decision** made, the **alternatives**
considered, and the **consequences**. ADRs are **immutable once accepted**: to change a decision, add
a new ADR that **supersedes** the old one (update the old one's status and link forward). This gives
future sessions the *why*, not just the *what*.

## When to write one

Write an ADR for: framework/architecture choices, persistence/ORM, auth strategy, external
integration boundaries (email, ingestion), background-processing/infrastructure additions
(Redis/BullMQ/workers), significant data-model decisions with business impact, and any reversal of a
previous ADR. Do **not** write one for routine implementation details.

## Process

1. Copy the template below to `NNNN-short-title.md` (zero-padded, next number).
2. Fill it in; set **Status: Proposed**.
3. On acceptance, set **Status: Accepted** and add it to the index.
4. To change it later, create a new ADR and mark this one **Superseded by ADR-XXXX**.

## Status values

`Proposed` · `Accepted` · `Superseded by ADR-XXXX` · `Deprecated`.
An ADR may also carry **"Accepted (needs business validation)"** when a decision is a reasonable
default awaiting confirmation from stakeholders.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-nextjs-app-router-architecture.md) | Next.js App Router as the application architecture | Accepted |
| [0002](0002-postgresql-and-prisma.md) | PostgreSQL with Prisma ORM and migrations | Accepted |
| [0003](0003-authentication-with-authjs.md) | Authentication & authorization with Auth.js + server-side RBAC | Accepted |
| [0004](0004-email-provider-abstraction.md) | Email provider behind an internal port; vendor deferred | Accepted — **vendor selected in ADR-0025 (Resend); the port is unchanged** |
| [0005](0005-job-queue-strategy.md) | Defer Redis/BullMQ; in-process scheduling first | Accepted |
| [0006](0006-contact-data-model-and-required-fields.md) | Contact partial-data model & required-fields reconciliation | Accepted — origin/dedupe **amended by ADR-0007** |
| [0007](0007-monday-crm-source-of-truth.md) | Monday.com as the CRM source of truth (platform is a read-only projection) | Accepted |
| [0008](0008-test-safe-send-mode-and-unsubscribe.md) | Test/Safe-send mode & locally-owned, sync-immune unsubscribe | Accepted |
| [0009](0009-communication-address-and-dedup-ledger.md) | CommunicationAddress, deduplicated delivery ledger & test-send isolation | Accepted — **authoritative for the data model** |
| [0010](0010-newsletter-automation-and-content.md) | Recurring newsletter automation, multi-content composition & reviewed external content | Accepted — **implemented by ADR-0026** |
| [0011](0011-canonical-email-rendering.md) | One canonical newsletter rendering path (preview = sent HTML) | Accepted |
| [0012](0012-authoring-media-and-safe-test-send-ui.md) | Content authoring, image storage & the SAFE test-send surface | Accepted |
| [0013](0013-microsoft-graph-safe-test-send.md) | Microsoft Graph SAFE TEST sending with explicit, hash-bound approval | Accepted — **transport superseded by ADR-0014** (approval model still authoritative) |
| [0014](0014-gmail-smtp-safe-test-send.md) | Gmail SMTP as the SAFE TEST transport | Accepted |
| [0015](0015-newsletter-visual-redesign.md) | Editorial newsletter layout, bidi isolation & omission of non-deliverable images | Accepted |
| [0016](0016-cloudinary-image-hosting.md) | Cloudinary as the newsletter image store | Accepted |
| [0017](0017-monday-crm-read-only-sync.md) | Read-only Monday CRM synchronization (composite identity, create-only communication state, anti-mass-archival guard) | Accepted |
| [0018](0018-segments-and-audience-resolution.md) | Segments, two-stage audience resolution & explainable exclusions | Accepted |
| [0019](0019-no-reply-newsletter-behaviour.md) | No-reply Reply-To, AXIS sender display name & footer-only unsubscribe (unchanged) | Accepted |
| [0020](0020-communication-language-assignment.md) | Staff-assigned communication language, bulk enrichment & never-inferred values | Accepted |
| [0021](0021-communication-consent-management.md) | Staff-recorded communication consent, evidence requirements & bulk safeguards | Accepted |
| [0022](0022-final-audience-and-send-readiness.md) | Immutable final audience, hash-bound production approval & the send-readiness checklist | Accepted |
| [0023](0023-authentication-and-four-eyes-enforcement.md) | Credentials authentication (Argon2id), server-enforced roles & enforced four-eyes approval | Accepted — **implements ADR-0003**; admin-capability note amended by ADR-0026 |
| [0024](0024-public-unsubscribe-and-production-delivery.md) | Public tokenized unsubscribe, production delivery ledger & the disabled production provider | Accepted — **vendor still deferred (ADR-0004)** |
| [0025](0025-resend-provider-domain-auth-and-internal-pilot.md) | **Resend** selected as the production provider, AXIS domain authentication, signed webhooks & the internal provider pilot | Accepted — **production delivery still LOCKED** |
| [0026](0026-content-sources-review-inbox-and-assisted-automation.md) | Content sources (RSS/Atom), SSRF-guarded ingestion, the review inbox, AXIS editorial copy & assisted DRAFT automation | Accepted — **amends ADR-0023's admin-capability note**; automation never sends |

---

## Template

```markdown
# ADR-NNNN: <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <roles>

## Context
<The forces at play: requirements, constraints, problem being solved.>

## Decision
<The choice made, stated clearly.>

## Alternatives Considered
<Options and why they were not chosen.>

## Consequences
<Positive and negative results; follow-ups; what this commits or precludes.>
```
