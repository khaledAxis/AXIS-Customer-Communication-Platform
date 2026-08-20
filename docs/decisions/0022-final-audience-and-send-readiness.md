# ADR-0022: Immutable final audience, hash-bound production approval and the send-readiness checklist

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Administrator/developer, AXIS management

## Context

ADR-0018 gave the platform segments, two-stage audience resolution and explainable
exclusions, plus a **draft** audience snapshot that is explicitly planning data: it is
re-derivable and is replaced whenever it is recomputed. ADR-0013 gave the SAFE TEST send
an approval bound to a SHA-256 of the exact rendered message.

Neither answers the question that has to be answered before a real customer newsletter:

> Has **this exact newsletter**, to **this exact set of people**, been approved — and is
> that still true right now?

A draft snapshot cannot answer it, because it is designed to change. A test approval
cannot answer it, because it covers a message sent to one hard-coded address and knows
nothing about an audience.

This milestone builds that answer and stops immediately before delivery. **Production
customer sending is not implemented and must not become possible as a side effect.**

## Decision

### 1. A FINAL audience is a separate, append-only concept

Three new tables, deliberately not an extension of the draft ones:

- **`CampaignFinalAudience`** — one frozen resolution: the campaign, the segment id, a
  frozen copy of the segment rules, the campaign language, the required language, every
  funnel count, the exclusion breakdown, the consent split, the CRM sync it was resolved
  against, and the audience hash.
- **`CampaignFinalAudienceDestination`** — one row per eligible normalized email, with
  its language, consent, address status and the contributing CRM records frozen as JSON
  provenance. Unique on `(finalAudienceId, normalizedEmail)`.
- **`CampaignFinalAudienceExclusion`** — the exclusions for the same moment, with the
  reason and the friendly CRM name as they stood.

**Rows are written once and never updated.** Preparing the audience again creates a
*new* `CampaignFinalAudience`; the newest row is the current one. Immutability is a
property of how the code writes, not a promise in a comment: there is no update path for
a snapshot's content anywhere in the service, and a test asserts an old snapshot is
byte-for-byte identical after a re-preparation.

Destinations are **not** `CampaignRecipient` rows. That table is the deduplicated
*production delivery ledger* (ADR-0009) and its existence means an email was or will be
dispatched. Writing rows there during preparation would make "was this sent?"
unanswerable. `CampaignAudienceExclusion` is likewise not overloaded to carry eligible
addresses — an exclusion table listing included people is a trap for the next reader.

Both lists are bounded at 20,000 rows. Truncation is recorded on the snapshot, surfaced
as a readiness WARNING and stated in the success message. It is never silent.

### 2. Staleness is a comparison, not a flag

`domain/audience/finalAudience.ts` serializes a resolved audience deterministically
(sorted destinations and exclusions, length-prefixed fields, stable JSON for the segment
rules) and hashes it. The readiness screen **always re-resolves the audience live** and
compares.

This is the whole design. Nothing has to subscribe to events, and no code has to
remember to invalidate anything. A Monday resync, a language change, a consent change,
an unsubscribe, a suppression, an edited segment or a changed campaign language all move
one of the hashed inputs, so all of them make the snapshot stale automatically. Segment
replacement, edited segment rules and a changed campaign language are additionally
detected by name, so the message tells a person what *they* changed.

A stale snapshot is `BLOCKED`, never a warning:
*"Audience changed after snapshot. Prepare the final audience again."*

Deliberately **not** hashed: friendly CRM display names. A company renamed in Monday must
not invalidate an approval — the same people still receive the same email.

### 3. Production approval extends the ADR-0013 philosophy with the audience

`CampaignProductionApproval` binds a SHA-256 over: subject, preheader, HTML, text,
ordered content item ids, image URLs, campaign language, sender address, sender display
name, reply-to, **the final audience id** and **the audience hash**. At readiness time
everything is re-rendered, re-resolved and re-hashed. A client-supplied "approved" flag
is never trusted, and there is no parameter through which one could be supplied.

The failure modes are distinguished because they call for different explanations:
`CONTENT_CHANGED`, `AUDIENCE_REPLACED` (someone prepared a newer snapshot),
`AUDIENCE_CHANGED` (the same snapshot no longer matches reality), `WRONG_SENDER`,
`WRONG_REPLY_TO`, `REVOKED`. Preparing a new final audience revokes any open approval so
the reason is visible rather than leaving a stale row looking current.

An approval authorizes nothing on its own. There is no delivery engine behind it.

### 4. Four-eyes is built, and reported BLOCKED

`evaluateFourEyes` implements the real rule: an authenticated approver, with a manager or
administrator role, who is not the creator. Administrators are **not** exempt here —
the ADR-0009 admin exemption covers unblocking a stuck workflow, not authorizing a real
customer send.

The platform has no sign-in yet (ADR-0003 is still pending): every action is attributed
to one local development actor. Approvals therefore record
`authenticatedActor = false`, and the four-eyes check reports **BLOCKED** with
*"Nobody is signed in…"*.

We did not fake a second employee to make the check pass, and we did not soften the rule
to accommodate the gap. A safety control that reports green while proving nothing is
worse than one that says plainly it is not available yet.

### 5. Readiness is one deterministic pure function

`domain/campaign/sendReadiness.ts` maps a description of the campaign's state to an
ordered checklist across five groups — CONTENT, AUDIENCE, COMMUNICATION, APPROVAL,
INFRASTRUCTURE — each item `READY`, `WARNING` or `BLOCKED`. Any BLOCKED item makes the
campaign not ready.

The COMMUNICATION group **states** the unsubscribe/suppression/address/language posture
rather than re-deriving it. Those rules were applied by the one eligibility engine that
produced the counts; a second implementation here is exactly what CLAUDE.md forbids.

`preparationComplete()` reports "everything a person controls is done", separately from
`ready`, which can never be true while production is blocked.

### 6. Production sending is hard-wired unavailable

The INFRASTRUCTURE check is `BLOCKED` unconditionally. The `production.enabled` input is
read and discarded so that enabling it later has to be a deliberate edit to that line.
There is no send action, no route handler and no service function that could reach a
customer: `sendReadinessService` imports no email provider, and a test asserts the whole
readiness code path contains no mail-transport reference at all.

The UI shows a disabled control reading *"Production customer sending has not been
enabled."*

### 7. SAFE TEST is untouched and stays separate

`axisgpscana@gmail.com → khaled-s@axis-gps.com`, its own hash, its own single-use
approval, its own `CampaignTestSend` ledger. A production approval and a test approval
do not interact in either direction, and a test send never touches a final audience.

## Alternatives Considered

- **Reuse `CampaignAudienceSnapshot` for the final audience.** Rejected: that table is
  deliberately replaced on every recompute, which is the exact opposite of what an
  approval needs to point at. Two concepts sharing one table would mean one of them is
  wrong.
- **Write `CampaignRecipient` rows at preparation time.** Rejected: those rows mean
  delivery. Creating them before a delivery engine exists would corrupt the meaning of
  the ledger and of the `@@unique([campaignId, normalizedEmail])` guard.
- **A `isStale` boolean maintained by triggers or events.** Rejected: it is only correct
  while every writer remembers to set it. The hash comparison is correct by
  construction, including for changes nobody anticipated.
- **A child table for destination provenance.** Rejected as the larger schema change for
  no safety gain: the provenance is written once with its destination and read back with
  it, never queried across snapshots.
- **Let an administrator self-approve so four-eyes can be demonstrated.** Rejected. See
  §4 — that would weaken the architecture to make a screenshot look better.
- **Hash only the audience count.** Rejected: swapping one recipient for another leaves
  the count identical.

## Consequences

**Positive**

- "Is this ready?" has one deterministic answer, computed the same way by the UI and the
  tests.
- An approval cannot outlive the thing it approved. Any change to content, sender, reply
  address or audience invalidates it automatically.
- Every number on the screen is explainable: matched records, unique addresses,
  duplicates collapsed, eligible, excluded, and a reason per exclusion.
- The remaining blockers to a real customer newsletter are now explicit and visible
  rather than assumed.

**Negative / follow-ups**

- **Real authentication is required before any production send.** Four-eyes will stay
  BLOCKED until ADR-0003 is implemented, and that is intentional.
- A very large audience re-resolves on every readiness page load. At 1,215 companies and
  1,423 contacts this is fast; it will need caching or a background resolution long
  before it is a problem.
- Snapshots accumulate one row set per preparation. There is no retention policy yet;
  they are small and are audit-relevant, so this is deferred rather than solved.
- The frozen `sources` JSON is not queryable across snapshots. Accepted deliberately.
