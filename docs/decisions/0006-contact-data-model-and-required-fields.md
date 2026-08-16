# ADR-0006: Contact partial-data model & required-fields reconciliation

- **Status:** Accepted (needs business validation)
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

Customer/contact data is imported from **Hashavshevet** via Excel/CSV and is frequently
**incomplete**: contacts may lack first/last name, phone, **email**, **industry**, product/brand
interests, **language**, job title, and company metadata. The brief's data-quality rules (requirements
§7, rules 1–12) require that incomplete records still import, that gaps be visible and enrichable,
that invalid emails be flagged (not dropped), and that missing language be explicit (`UNKNOWN`), never
silently Hebrew.

The same brief also contains a terse trailing instruction: **`email: required`, `language: required`,
`industry: required`**. Taken literally as database `NOT NULL` constraints, this **directly
contradicts** rules 1–10 (e.g. rule 4: "Contacts without email may exist in the database"; rule 3:
"Missing segmentation data must not prevent importing"; rule 7: missing language → `UNKNOWN`). A
decision is needed that does not lose data yet honors the intent behind "required."

## Decision

Separate **persistence requirements** from **eligibility/completeness requirements**.

1. **Persistence layer (import must never fail on missing metadata):** `email`, `language`,
   `industry` — and other business metadata — are **nullable**. Language is an explicit enum
   `HE | AR | UNKNOWN`; email carries an `emailStatus` (`UNKNOWN | VALID | INVALID`). Raw source rows
   are preserved for audit.
2. **Eligibility/completeness layer (what "required" means):** a contact is a valid **target of a
   localized, industry-segmented email campaign** only when it has:
   - a **valid email** ⇒ *sendable* (plus not unsubscribed/suppressed, `ACTIVE`, consent ≠ DENIED),
   - a **known language** (`HE`/`AR`, not `UNKNOWN`) ⇒ *renderable* in the right direction/content,
   - a **known industry** ⇒ *segmentable* by industry.
   Contacts missing any of these are still **imported and stored**, marked **incomplete**, and
   **excluded from the relevant sends** until enriched. Eligibility is **derived and re-checked at
   send time**, never assumed from row existence.

The **only** truly required (`NOT NULL`) fields are those needed for system integrity (primary keys,
foreign keys, timestamps, enum discriminators with sensible defaults like `emailStatus=UNKNOWN`,
`language=UNKNOWN`, `status=ACTIVE`, `consentStatus=UNKNOWN`).

## Alternatives Considered

- **Literal `NOT NULL` on email/language/industry:** would reject or force-fabricate values for most
  Hashavshevet rows, **losing data** and violating rules 1–10. Rejected.
- **Everything nullable with no "required" concept:** satisfies import but ignores the "required"
  intent and risks silently attempting to send to unsendable/unsegmentable contacts. Rejected.
- **A single boolean `isComplete` flag only:** too coarse; we need to know *why* a contact is
  incomplete (no email vs invalid email vs unknown language vs unknown industry) for the import
  preview classes and enrichment UI. We therefore keep granular fields/statuses and derive
  completeness/eligibility from them.

## Consequences

- Incomplete customers import cleanly and are visibly enrichable; no data loss.
- "Sendable" and "campaign-complete" are explicit, tested, derived predicates — not schema-level
  guesses — which directly powers the import preview classes (`SENDABLE`/`INCOMPLETE`/`NO_EMAIL`/
  `INVALID_EMAIL`/…) and the send-time eligibility filter.
- Slightly more logic in `domain/` (eligibility + completeness functions) instead of DB constraints —
  intended, and unit-testable.
- **Needs business validation:** confirm this interpretation of `email/language/industry: required`
  (eligibility/completeness, not `NOT NULL`). If the business truly wants hard `NOT NULL`, that would
  change the import strategy (reject or quarantine incomplete rows) and this ADR must be superseded.
  See requirements §11 Open Questions #1.
