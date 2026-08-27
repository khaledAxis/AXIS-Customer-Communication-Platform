# ADR-0030 — Recording human rendering observations about sent QA messages

- **Status:** Accepted
- **Date:** 2026-08-24
- **Builds on:** [ADR-0027](0027-qa-email-allowlist.md), [ADR-0028](0028-durable-qa-ledger-and-run-caps.md)
- **Sends nothing.** No transport is reachable from any code introduced here.

## Context

Twenty QA emails were sent and accepted. Acceptance is a provider fact; it says nothing
about whether Arabic letters joined correctly, whether Gmail clipped the long message,
or whether Reply-To actually reads `noreply@axis-gps.com` when somebody presses Reply.

Those answers exist only in four inboxes, and only a person can produce them. Without
somewhere to write them down they live in a chat log or in nobody's memory, and the
platform cannot say which parts of its rendering have genuinely been verified.

## Decision

### 1. A review is a record of observation, not an action

`QaReviewCheck` records one reviewer verdict about one check of one already-sent
message: `PASS`, `FAIL` or `NOT_CHECKED`, with an optional severity and note.

`qaReviewService.ts` imports no provider, holds no recipient field, and contains no
reference to any send path — asserted against the source. The review page has no
recipient selector, no scenario picker and no send button. **Reviewing cannot become
resending**, and it consumes no QA quota.

### 2. It never writes to the send ledger

The service writes only to `QaReviewCheck`. It never updates, creates or deletes a
`QaEmailSend`. The ledger records what was sent and the caps are computed from it; a
review is what somebody thought of it. Keeping them apart means an opinion can never
alter send history or hand back quota — the same separation ADR-0028 exists to protect.

### 3. `NOT_CHECKED` is the default and stays honest

An unfilled checklist reads as unreviewed, never as clean. The board reports passed,
failed and not-checked separately and never rolls "nobody looked" into a pass.

### 4. The checklist reuses what the scenario already said

Each scenario in `qaScenarios.ts` already carries an `inspect` list — the things to look
at, written when the message was designed. The review checklist is that list, so the
reviewer answers the question the test was built to ask rather than a generic one.

The label is **snapshotted** onto the review row, so editing the catalogue later cannot
retroactively change what a reviewer approved.

### 5. Severity is cleared when a check stops failing

Severity describes a defect. A check moved back to `PASS` drops it, so a stale
`CRITICAL` can never sit attached to a passing check and misreport the closure state.

## Consequences

- The platform can state which rendering behaviour has been verified by a human and
  which has not — and, at the time of writing, **none has**: all checks are
  `NOT_CHECKED`, which is the truthful state, not a failure.
- Defects get a severity and a note, so a retest can be justified by name.
- One more table and one more page. Deliberately small: no screenshot upload, no
  per-client matrix, no workflow states.

## Alternatives considered

**Record observations in a document.** Rejected: it would not be tied to provider
message ids, so "which message was this about?" would rely on memory.

**Let a FAIL trigger an automatic retest.** Rejected — a retest is a live email to a
colleague and consumes quota. It requires explicit human authorisation, every time.
