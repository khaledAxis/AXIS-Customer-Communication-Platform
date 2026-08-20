# ADR-0020: Staff-assigned communication language

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Administrator/developer (architect)
- **Relates to:** implements the local-ownership boundary of ADR-0009, unblocks the localized
  audiences of ADR-0018, and deliberately does **not** touch the consent rules of ADR-0008.

## Context

All 1,319 mirrored communication addresses had `language = UNKNOWN`, and the conservative eligibility
rule excludes an unknown language from a localized send. The consequence, measured in the previous
milestone: **a Hebrew or Arabic newsletter reached zero addresses**. Every other part of the pipeline
worked; language was the single blocker.

Monday has no language column, so the value cannot come from a sync. It has to be entered by people,
and 1,319 addresses is far too many to edit one at a time.

## Decision

### 1. Language is local, and only a person can set it

`CommunicationAddress.language` is AXIS-owned and sync-immune (ADR-0009). A Monday sync writes
mirrored CRM fields only; `ensureCommunicationAddress()` remains create-only and never updates.
Language is therefore always the result of a deliberate human action, which is why every change is
audited.

### 2. Nothing is ever inferred

No guessing from a person's name, an email domain, a company name, or CRM presence. A name is not a
language, and a wrong guess sends a customer a newsletter they cannot read — while looking like a
deliberate choice. `UNKNOWN` stays `UNKNOWN` until someone decides otherwise.

The optional "suggested language" mechanism the brief allowed was **skipped**: the mirrored data
contains no signal that would be honest to base a suggestion on. Offering a suggestion with no real
evidence would launder a guess into an apparent recommendation.

### 3. One row per address, with its CRM provenance

The editable unit is the `CommunicationAddress`, never the CRM record. One address commonly belongs
to several records — a company plus two of its contacts — and they share one communication profile.
The UI shows every contributing record on the row and warns *"Shared by N records — one setting for
all of them"*, so nobody changes a shared setting believing it affects one person.

### 4. Language, and nothing else

The write path accepts a language and a list of address ids. There is no consent field, no
`emailStatus` field, and no unsubscribe or suppression field anywhere in the parser, the service, or
the server action — so those cannot be changed here even by accident. The Prisma update payload
contains exactly one column.

This is the point of the milestone: bulk-editing *consent* would be a legal decision disguised as a
data-cleanup feature. **Assigning a language never implies consent.**

### 5. Selection uses CRM context, but the decision stays human

Staff can filter by classification, company, category, source kind, current language, consent, email
status and delivery state, then select a page or all matches and apply one language. The platform
never decides that "GPS customers are Hebrew speakers" — it makes that selection *expressible* and
leaves the judgement to the person.

Bulk changes are bounded (2,000 per operation) and require an explicit confirmation naming the count:
*"You are changing communication language for 143 email addresses."*

### 6. Every change is audited

One `AuditLog` row per address with `fromState`, `toState`, the actor, and the normalized email in
metadata. A bulk operation tags its rows with a shared `batchId`. Authentication is still a later
milestone, so the actor is the clearly-labelled local development user
(`dev-local@axis-gps.invalid`) — a stand-in, never an invented employee identity. No audit row is
written when the value did not actually change.

### 7. Impact is shown, not sent

After a change the UI reports the real before/after counts — *"Hebrew addresses 0 → 1 · Not set
1,320 → 1,319. Nothing was sent."* Existing audience previews pick the new values up immediately,
because segment membership is resolved live and never stored.

The conservative eligibility rule is unchanged: `UNKNOWN` and mismatched languages remain excluded
from a localized send, and a language assignment cannot override unsubscribe or suppression.

## Alternatives Considered

- **Inferring language from company or contact names.** Rejected — Hebrew and Arabic names do not
  reliably indicate reading preference, and the failure mode is invisible.
- **Defaulting everything to Hebrew because most customers are Israeli.** Rejected for the same
  reason, and it would silently manufacture consent-adjacent data at scale.
- **Bulk-editing consent in the same screen.** Explicitly rejected: consent is a legal record, not a
  data-quality field.
- **Storing language on `Contact` or `Company`.** Rejected — it is per-address by design (ADR-0009);
  two contacts sharing an address must not be able to disagree about the language of the same inbox.

## Consequences

- Localized newsletters become reachable as soon as staff assign languages. Until then the honest
  count stands: **1,319 addresses with no language, 0 Hebrew, 0 Arabic.**
- The 20% of the CRM without a usable address is unaffected — language cannot fix a missing email.
- One new audit action, `COMMUNICATION_LANGUAGE_CHANGED`, and no other schema change.
- A UI defect found during verification is worth recording: the confirm button and the request button
  occupied the same slot, so React reused one DOM node and flipped its `type` from `button` to
  `submit` mid-click, submitting immediately and skipping confirmation entirely. Distinct React keys
  fix it. The transaction is all-or-nothing, so the earlier failed attempt changed nothing.
