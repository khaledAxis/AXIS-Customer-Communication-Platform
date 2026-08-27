# ADR-0027 — Internal QA email on a separate four-address allowlist

- **Status:** Accepted
- **Date:** 2026-08-24
- **Builds on:** [ADR-0013](0013-microsoft-graph-safe-test-send.md), [ADR-0014](0014-gmail-smtp-safe-test-send.md), [ADR-0019](0019-no-reply-newsletter-behaviour.md), [ADR-0025](0025-resend-provider-domain-auth-and-internal-pilot.md)
- **Does NOT change:** the SAFE TEST hard-lock, production delivery, Resend, or DNS

## Context

Rendering can only be judged in a real inbox. Hebrew and Arabic right-to-left layout,
bidi isolation of Latin product names, Cloudinary images, dark mode, Outlook quirks and
the plain-text fallback are all invisible in a browser preview.

The SAFE TEST path (ADR-0013/0014) reaches exactly ONE address by hard-coded constant,
which is precisely why it is trustworthy — and precisely why it cannot answer the
question for four reviewers. Widening it would dismantle the control that makes it safe.

The provider pilot (ADR-0025) is not an option either: Resend holds only a placeholder
key, so it cannot send at all.

## Decision

### 1. A THIRD port, not a widened second one

`QaEmailProvider` is a distinct interface from both `EmailProvider` (SAFE TEST) and
`ProductionEmailProvider` (customers). Three types mean a mis-wired registry is a
compile error. `GmailQaEmailProvider` shares Gmail's *credentials* — the only transport
AXIS has configured — but shares no POLICY: `assertSafeTestEnvelope` is never called in
the QA adapter, and `assertSafeQaEnvelope` is never called in the SAFE TEST adapter,
asserted against the source.

**SAFE TEST is unchanged.** It still reaches one address, and still refuses the other
three QA addresses.

### 2. The allowlist is four literals, and nothing else

`QA_ALLOWED_RECIPIENTS` is a frozen constant of four addresses in
`domain/send/qaPolicy.ts`. That file imports no Prisma, reads no `CommunicationAddress`,
`Contact`, `Company`, `Segment`, `CampaignRecipient` or final audience, and a test scans
its code to prove it. There is no lookup to redirect and no query to poison.

`assertSafeQaEnvelope` REFUSES rather than repairs, and returns the CONSTANT rather than
the caller's string, so a homoglyph cannot survive the gate. Refused: any other address
(including on axis-gps.com), plus-address aliases, `Name <addr>` forms, comma and
semicolon lists, arrays, objects, null, empty values, CC, BCC, and CR/LF/tab injection —
checked on the RAW value before trimming.

### 3. Every rejection makes ZERO provider calls

The gate runs before a provider object is obtained, so `providerCalls: 0` is structural
rather than promised. `QaSendOutcome.providerCalls` is returned as a number precisely so
a test can measure it, and 25 rejection cases assert it.

### 4. The subject identifies itself

Every QA subject begins `[AXIS Newsletter Platform TEST]`, applied idempotently and
re-checked in the adapter. A recipient can tell from the inbox line alone that the
message is a platform test, not a customer newsletter and not a suspicious email.

### 5. The body notice is QA-only and additive

`NewsletterDocument.qaNotice` is optional and rendered only when set. No production or
SAFE TEST path sets it, asserted by test. It is placed above everything else, and the
footer below it is byte-identical to a production render — the unsubscribe affordance a
recipient sees is unchanged.

### 6. Caps are enforced server-side, from the ledger

Hard limits: 40 total, 10 per recipient. Read from `CampaignTestSend` rows scoped to
`channel = QA_EMAIL`, never from a caller-supplied count, and a breach is REFUSED.

### 7. Off by default

`QA_EMAIL_ENABLED` is an environment variable, is not in the database, and no UI writes
it. It is separate from `PRODUCTION_DELIVERY_ENABLED`, which stays `false`; enabling QA
grants nothing on the customer path.

## Consequences

- Four reviewers can judge real rendering without the SAFE TEST lock being touched.
- QA email reaches AXIS colleagues. The subject prefix and the in-body notice exist so
  that lands as obviously internal rather than as unexpected mail.
- **Three defects were found while building this**, all now fixed:
  1. `providerPilot.int.test.ts` left a `ProviderDomainSnapshot` claiming Resend had
     verified `axis-gps.com`, in the real development database — a false "verified" on
     the admin screen for a check that never happened.
  2. `contentAutomation.int.test.ts` asserted a GLOBAL `campaignRecipient` count, which
     raced with the delivery suite and failed intermittently.
  3. The QA suite's own cleanup deleted every `QA_EMAIL` ledger row rather than its own,
     which destroyed the evidence of an authorised live run and silently reset the caps
     that depend on that ledger.

## Alternatives considered

**Widen the SAFE TEST allowlist to four.** Rejected — that is the control, not an
implementation detail. Its value comes from being one hard-coded address.

**Wait for Resend.** Rejected: it cannot send, and rendering QA does not need a
production domain.

**Let the QA UI accept a typed address with server-side validation.** Rejected. The
validation would be the same, but a text box invites a fifth address to be attempted,
and the fixed selector makes the boundary visible to whoever uses it.
