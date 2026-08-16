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
| [0004](0004-email-provider-abstraction.md) | Email provider behind an internal port; vendor deferred | Accepted (vendor TBD) |
| [0005](0005-job-queue-strategy.md) | Defer Redis/BullMQ; in-process scheduling first | Accepted |
| [0006](0006-contact-data-model-and-required-fields.md) | Contact partial-data model & required-fields reconciliation | Accepted (needs business validation) |

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
