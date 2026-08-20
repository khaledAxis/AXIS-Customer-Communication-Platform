# ADR-0021: Staff-recorded communication consent, evidence and bulk safeguards

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Administrator/developer, AXIS management

## Context

`CommunicationAddress.consentStatus` has existed since ADR-0009 as a locally-owned,
sync-immune field with three values (`UNKNOWN`, `GRANTED`, `DENIED`). Until now nothing
could write it: ADR-0020 gave staff a workflow for **language** and deliberately gave
consent no write path at all, because consent is a business and legal decision rather
than a data-quality one.

Preparing for real customer newsletters makes that gap the blocker. All **1,319**
mirrored addresses are `UNKNOWN`. Somebody has to be able to say, per address, "yes we
may contact these people, and here is why" — and, just as importantly, "no, never
contact this one".

The forces:

- **Monday has no consent column.** Nothing can be mirrored; every value is a
  deliberate human act. A sync must never write, clear or overwrite it (ADR-0007/0009).
- **Consent must never be inferred.** Not from a language, not from a name, not from a
  CRM record existing. A record exists because a company bought a GPS receiver, which is
  not the same statement as "this person agreed to receive marketing email".
- **The asymmetry is real.** Approving an address is the only change here that can lead
  to mail being sent. Refusing is always safe. A design that treats them symmetrically
  either makes refusing annoying or makes approving too easy.
- **This software must not make a legal determination.** It can record what a person
  asserted and who asserted it. Whether that basis is adequate under Israeli or EU rules
  is the operator's decision, and the wording must never suggest otherwise.
- **Consent is not the strongest signal.** An unsubscribe or a suppression must keep
  overriding it, or the platform would have a legitimate-looking route to emailing
  somebody who asked us to stop.

## Decision

### 1. Consent stays local, email-centric and sync-immune

Consent lives on `CommunicationAddress`, keyed by `normalizedEmail`, exactly like
language. Several CRM records commonly share one address and therefore one decision; the
UI says so on every row.

### 2. `GRANTED` carries evidence; the other values do not

New nullable columns on `CommunicationAddress`, all `[L]` (locally owned):

| Column | Meaning |
| --- | --- |
| `consentSource` | The documented basis a person selected (`ConsentSource` enum) |
| `consentNote` | Free-text description of that basis, ≤ 500 characters |
| `consentEffectiveAt` | The date the permission applies from; never in the future |
| `consentRecordedAt` | When the change was made here |
| `consentRecordedById` | Who made it |
| `consentBatchId` | Groups one bulk operation |

`ConsentSource` values are **administrative labels**, not legal categories:
`EXISTING_CUSTOMER_RELATIONSHIP`, `EXPLICIT_CUSTOMER_PERMISSION`,
`IMPORTED_DOCUMENTED_PERMISSION`, `OTHER_DOCUMENTED_BASIS`. `OTHER_DOCUMENTED_BASIS`
requires a note, because on its own it documents nothing.

Setting `GRANTED` requires **all** of: an explicit confirmation, a basis, and an
effective date. Setting `DENIED` or `UNKNOWN` requires the confirmation only — refusing
to email someone never needs paperwork, and demanding some would discourage the safe
choice. Moving `DENIED → GRANTED` therefore requires fresh evidence like any other
approval; the old basis is cleared when consent moves away from `GRANTED`, because a
justification for sending must not stay attached to a refusal.

Validation refuses rather than repairs: an unrecognised basis is **not** mapped to
"Other", a missing basis is **not** defaulted, and an absent confirmation checkbox is
**not** read as `true`.

### 3. `UNKNOWN` behaviour is preserved exactly, and reported

The existing eligibility rule is unchanged: an address is excluded when
`consentStatus = DENIED`, and `UNKNOWN` does **not** block a send. That is the rule
CLAUDE.md has documented since ADR-0009 ("consent is satisfied where applicable
(`consentStatus ≠ DENIED`)"), and this ADR does not weaken or silently tighten it.

Two things are added instead:

- `evaluateEligibility` gains an **opt-in** `requireExplicitConsent` flag (default
  `false`) producing a new `ExclusionReason.CONSENT_NOT_CONFIRMED`, distinct from
  `CONSENT_DENIED`: nobody refused, and nobody confirmed.
- The final-audience snapshot records `consentGranted` and `consentNotConfirmed`
  separately, and send readiness raises a **WARNING** naming the unconfirmed count
  (ADR-0022). Nothing is hidden; nothing is auto-upgraded.

Turning the flag on for production sends is a future decision that needs its own ADR and
a real consent-collection story. Making it the default today would report an eligible
audience of one address out of 1,319 and tell nobody why.

### 4. Consent never overrides the stronger facts

Order of evaluation in `domain/eligibility` is unchanged: address validity, then
unsubscribe, then suppression, then consent, then language. `GRANTED` + unsubscribed is
`INELIGIBLE`. The consent service physically cannot reach `Unsubscribe` or `Suppression`
— they are not in its update payload — and integration tests assert the outcome.

### 5. Language and consent cannot leak into each other

Two separate parsers, two separate services, two separate server actions, two separate
forms. `setLanguage`'s update payload contains `language` and nothing else;
`setConsent`'s contains consent and its evidence and nothing else. Assigning Hebrew can
never imply permission, because there is no field through which it could travel.

### 6. Bulk operations are bounded, explicit and confirmed

- At most **2,000** addresses per operation.
- No "grant consent to everyone" control exists, and nothing pre-selects all 1,319
  addresses. Selection is always an explicit act.
- Approving asks twice and the second step names the count:
  *"You are marking 47 communication addresses as approved for communication."*
- The confirmation text states plainly that approving does not override an unsubscribe,
  a blocked address or an invalid one.

### 7. Every change is audited

One append-only `AuditLog` row per address per change, action
`COMMUNICATION_CONSENT_CHANGED`, carrying from-state, to-state, actor, timestamp, the
recorded basis, the effective date, the note and the batch id. Audit rows are never
updated — a later change adds a row.

## Alternatives Considered

- **Block `UNKNOWN` from every send now.** Conservative, and defensible — but it changes
  a documented invariant, would silently reduce every audience to almost nobody, and
  belongs to the decision about how AXIS actually collects consent, not to this one. The
  opt-in flag exists so that change is one line and one ADR away.
- **Infer consent from an existing customer relationship.** Rejected outright. It is
  exactly the inference this platform refuses to make elsewhere, and it would put a
  legal assertion in the software's mouth rather than a person's.
- **Store consent on the contact or company record.** Rejected: the same address is
  commonly shared by a company and its contacts, and per-record consent would let one
  record be approved while another sharing the same inbox is refused.
- **Require a note for every basis.** Rejected as friction that would push people toward
  the least accurate label. Only `OTHER_DOCUMENTED_BASIS` requires one.
- **A single "consent" toggle with no evidence.** Rejected: an approval nobody can
  explain later is worse than no approval, and it makes bulk approval a one-click action.

## Consequences

**Positive**

- AXIS can record who may be contacted, with a defensible trail of who said so and why.
- Refusing is one confirmation; approving is deliberately slower. The safe direction is
  the easy one.
- Unsubscribe and suppression authority is unchanged and now explicitly tested.
- The unconfirmed-consent count is visible on the readiness screen instead of being an
  invisible assumption.

**Negative / follow-ups**

- All 1,319 addresses remain `UNKNOWN` until a person works through them. That is the
  honest state, not a defect.
- There is still no **customer-facing** consent capture (a preference centre, a signup
  form, a documented import). Everything here is staff-asserted.
- `consentRecordedById` records the local development actor until authentication exists
  (ADR-0003), so "who approved" is not yet provable. See ADR-0022 §four-eyes.
- `requireExplicitConsent` is implemented but unused in production paths; leaving dead
  configuration around is a small cost paid to keep the tightening one flag away.
