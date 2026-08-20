# ADR-0025 — Resend as the production email provider, AXIS domain authentication, and the internal provider pilot

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** the "vendor deferred" position of [ADR-0004](0004-email-provider-abstraction.md)
- **Builds on:** [ADR-0013](0013-microsoft-graph-safe-test-send.md), [ADR-0014](0014-gmail-smtp-safe-test-send.md),
  [ADR-0019](0019-no-reply-newsletter-behaviour.md), [ADR-0024](0024-public-unsubscribe-and-production-delivery.md)

## Context

ADR-0004 defined an `EmailProvider` port and deliberately refused to pick a vendor.
ADR-0024 added a second, separate `ProductionEmailProvider` port with exactly one
implementation — `DisabledProductionEmailProvider`, which throws — plus a delivery
ledger, a dispatch state machine and a provider-event contract that nothing yet fed.

Two things are still unknown, and no amount of code can answer either:

1. **Does mail sent as an AXIS domain actually arrive?** SPF, DKIM and DMARC are DNS
   facts about `axis-gps.com`, not application state. Until a real message travels a
   real path to a real inbox, deliverability is a guess.
2. **Does the platform correctly interpret what a provider says afterwards?** A bounce
   and a complaint carry obligations that outrank a recorded consent, and the code that
   applies them has never seen a genuine payload.

The Gmail SAFE TEST transport cannot answer either question. It authenticates as a
Gmail account, sends as `axisgpscana@gmail.com`, and tells us nothing about the AXIS
domain's reputation or DNS.

## Decision

### 1. Resend is the production provider

`ResendProductionEmailProvider` implements the existing `ProductionEmailProvider` port.
It is the only file in the repository that imports the Resend SDK; domain code,
services and UI continue to depend on the port. Swapping vendors means writing a
sibling file and changing one line in the registry, exactly as ADR-0004 promised.

`DisabledProductionEmailProvider` remains, and remains the fallback: the registry
resolves to Resend only when `PRODUCTION_EMAIL_PROVIDER=resend` **and** an API key is
present. Anything else — an unset variable, a blank key, a typo — degrades to the
adapter that throws. A half-configured vendor must degrade to "cannot send", never to
"sends somewhere unexpected".

Selecting a vendor is **not** enabling delivery. `PRODUCTION_DELIVERY_ENABLED` remains
a separate switch and remains `false`.

### 2. Accepted is not delivered — now enforced at the adapter

`emails.send` returning an id maps to `ACCEPTED`. Only an `email.delivered` webhook may
produce `DELIVERED`. Resend's own `email.sent` event is mapped to a new
`ProviderEventType.ACCEPTED` rather than to anything called "sent", so the distinction
survives translation.

A broken connection or an unreadable answer is `UNCERTAIN`, never `FAILED`, and is
never automatically retried: a `FAILED` is safe to re-submit and an `UNCERTAIN` is not.

### 3. Domain authentication is READ, never assumed

`fetchDomainStatus` reads the domain's state from the provider. It creates nothing,
edits no DNS, and sends nothing. The answer is stored as a `ProviderDomainSnapshot`
with the time it was taken, and the admin screen shows that time — a week-old
"verified" must not read as a live fact.

`checkConfiguration()` stays network-free, because readiness renders on every page
load. Without a stored snapshot the adapter reports the domain as **not checked**,
which is different from "not verified" and is displayed differently.

**DMARC is always `UNKNOWN` from a provider report.** AXIS publishes DMARC; no provider
can confirm it, and this platform performs no DNS lookups. The admin screen says so and
offers a staged rollout — `p=none` first, then `quarantine`, then `reject` — because
starting at `p=reject` discards legitimate unaligned mail silently, and you find out
from the customer who never received an invoice.

DNS records are **displayed, never applied**. Every value shown came from the provider;
none is invented.

### 4. Webhooks are verified before they are read

`POST /api/webhooks/resend` reads the raw body, verifies the Standard Webhooks
signature through the adapter, and only then looks at the payload. Nothing before
verification touches the database.

A request that cannot be verified — no secret configured, missing signature headers, a
bad signature, a replayed timestamp — is refused with `401` and changes no state. The
rejection body carries no recipient, no campaign and no reason: a probe learns only
that it was refused.

A verified duplicate returns `200`. Anything else makes the provider retry forever, and
a retry storm is its own outage.

### 5. The internal provider pilot

One email, through the production transport, as
`AXIS Advanced Mapping Solutions <newsletter@axis-gps.com>`, to exactly one hard-coded
address: `khaled-s@axis-gps.com`.

The safety shape is copied from ADR-0013 because it worked: **the audience is
unrepresentable, not merely validated**. There is no `from`, `cc`, `bcc` or `replyTo`
field a caller could set, `to` is a single string, and `assertSafePilotEnvelope`
refuses — never trims — a second recipient, an array, a comma-separated pair, a
control character, or any address that is not the constant. It runs in the service and
again inside the adapter, immediately before the network call.

- Gated by `PROVIDER_PILOT_ENABLED`, a **separate** switch from
  `PRODUCTION_DELIVERY_ENABLED`. The dispatch worker deliberately never reads it.
- Blocked while the sending domain is unverified: a pilot from an unauthenticated
  domain proves nothing about what a customer send would do.
- Approval is bound to a SHA-256 of the exact rendered message and is single-use,
  enforced by the existing `UNIQUE CampaignTestSend.approvalId`.
- Every subject carries `[AXIS PROVIDER PILOT]`, applied idempotently.
- It writes **no** `CampaignRecipient`, `CampaignEvent` or `CampaignFinalAudience` rows.
- **A human triggers it.** There is no scheduler, no worker and no test that sends one.

### 6. Channels cannot substitute for one another

`SendChannel` (`SAFE_TEST_GMAIL` | `PROVIDER_PILOT`) is stored on both
`CampaignTestApproval` and `CampaignTestSend`. The two channels share those tables and
nothing else: every query is scoped, so a Gmail approval can never authorise a Resend
submission or the reverse. Tests assert against the source that the pilot service never
names `getEmailProvider` and the SAFE TEST service never names
`getProductionEmailProvider`.

### 7. Unsubscribe appearance is unchanged

One small footer link. **No** `List-Unsubscribe`, no `List-Unsubscribe-Post`, no Gmail
one-click control, no unsubscribe UI near the sender — including on the Resend path.
Tests assert their absence, so adding one later must be a deliberate act.

## Consequences

- **The vendor question is answered, and the port survived it.** One new file imports
  an SDK; nothing else changed shape.
- **The pilot can prove deliverability without risking a customer.** The worst outcome
  of a bug in this path is an unexpected email to an AXIS colleague.
- **Production is still locked, and the lock is now load-bearing in more places:**
  `dispatchCampaign` refuses before reading anything, and the readiness screen reports
  the provider, the domain, the webhook and the public unsubscribe as separate facts.
- **The development machine is not exposed.** No port forwarding, no tunnel. Until the
  app runs on an internal HTTPS host, delivery events do not arrive — a known,
  acceptable state while sending is locked, and reported as such rather than hidden.
- **A defect was found by writing the tests:** a retried webhook about an address with
  no ledger row crashed on the suppression's unique index instead of being recognised
  as a duplicate, because de-duplication checked only `CampaignEvent`. It now checks
  `SuppressionEvent` too.

## Alternatives considered

**Keep deferring the vendor.** Rejected: deliverability cannot be tested in the
abstract, and the questions above only get more expensive to answer later.

**Send the pilot to a customer-shaped test address.** Rejected. The one authorised
recipient is an AXIS colleague who has agreed to receive it. Anything else is customer
email by another name.

**Enable production delivery for "just one" campaign.** Rejected, and this is the
distinction the whole milestone turns on: a pilot with a hard-coded recipient and a
production send with a resolved audience are different code paths, and only one of them
can be wrong quietly.

**Add `List-Unsubscribe` while touching the provider.** Rejected. It is a real
deliverability improvement and a visible change to what recipients see; it belongs to
its own decision, not to a vendor integration.
