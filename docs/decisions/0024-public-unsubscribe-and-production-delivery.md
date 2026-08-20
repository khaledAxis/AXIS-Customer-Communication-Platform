# ADR-0024: Public tokenized unsubscribe, production delivery ledger and the disabled production provider

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Administrator/developer, AXIS management

## Context

Two of the three hard blockers listed at the end of ADR-0023 are infrastructure that
has to exist before any customer newsletter can go out:

- **There was no public unsubscribe endpoint.** ADR-0008 requires a working, no-login,
  tokenized unsubscribe link in every customer newsletter. `unsubscribeUrl` was still
  `null`, and the footer rendered a placeholder saying the link would be activated
  before real sending.
- **There was no production delivery path.** `CampaignRecipient` existed as a schema
  with nothing to write it, no provider port for bulk sending, no dispatch pipeline,
  and no bounce/complaint ingestion.

ADR-0004 deferred the vendor choice, and this milestone does not pre-empt it. The
brief is explicit: build the architecture, send nothing, and keep production locked.

A third, smaller item is settled here too: ADR-0023 recorded `mustChangePassword` and
did not enforce it, so a password two people knew stayed usable indefinitely.

## Decision

### 1. The unsubscribe token carries no data

A 32-byte CSPRNG secret, base64url-encoded, stored only as its SHA-256 — exactly as a
password is. Everything the endpoint needs (which address, which campaign) lives on the
row the hash matches.

That single choice answers the requirements at once:

- **unguessable** — 256 bits;
- **tamper-proof without a signature** — there is no payload to alter, so a modified
  token matches no row at all; it cannot resolve to a *different* address because it
  cannot resolve to *any*;
- **no internal identifiers exposed** — no address id, contact id, company id, Monday
  id or email appears in the URL;
- **contains no secret of ours** — it is not signed with a server key, so a leaked
  token compromises one address's unsubscribe and nothing else;
- **revocable** — a row can be marked revoked; a stateless JWT cannot.

A signed/encrypted payload was the alternative and is weaker here: it embeds
identifiers, is only as strong as one signing key, cannot be revoked, and grows the
URL. Nothing in this flow needs statelessness — the endpoint has a database.

SHA-256 rather than Argon2 is correct for this one case: the input is 256 bits of
uniform randomness, so there is no dictionary to attack and no work factor to buy. That
reasoning does **not** transfer to passwords.

### 2. GET resolves, POST unsubscribes

`GET /unsubscribe/<token>` shows a confirmation page and changes nothing.
`POST` (a Next.js server action) records the unsubscribe.

**The confirmation step is not CSRF protection**, and pretending otherwise would be
muddled thinking. The classic CSRF threat is an attacker causing a *victim's
authenticated session* to act; there is no session here, the token is not a cookie, and
anyone able to forge the request already holds the token and could simply open the link
themselves.

What the POST actually buys is accident-safety: mail clients prefetch links, security
appliances open every URL in a message, and corporate proxies follow them on the
recipient's behalf. A GET that unsubscribed would silently opt out people who never
clicked. Next.js server actions add a same-origin check on top at no cost.

### 3. Every failure looks identical

Unknown token, revoked token, malformed token and throttled request all render the same
sentence. A distinguishable "no such token" versus "no such address" would make the
endpoint an oracle for discovering which addresses AXIS holds. The page also never
displays the address it resolved — a forwarded link must not tell its new holder whose
it was.

Invalid attempts are throttled per client (30/minute, best-effort IP from proxy
headers). A **valid** token is never counted, so a genuine recipient cannot be locked
out of unsubscribing no matter how busy the endpoint is. No CAPTCHA: brute-forcing 256
bits is already pointless, and a CAPTCHA between a person and an unsubscribe link would
be user-hostile.

### 4. Unsubscribe stays global, append-only, and public

`Unsubscribe` is unique on `(normalizedEmail, scope)`, so a refresh, double click or
retried POST records the same single fact. Nothing is deleted: the address, its
communication profile and its CRM provenance all survive. There is deliberately **no
public re-subscribe** — unsubscribing should be the easy direction, and coming back is
a decision that needs its own audited workflow.

The audit row carries `actorUserId: null` and `actor: "PUBLIC_RECIPIENT"`. A recipient
is not an AXIS employee, and inventing an authenticated user for a public action would
put a colleague's name on something a customer did.

### 5. The footer is unchanged; only the href moves

The visible newsletter is identical: one small unsubscribe link, footer only, same
prominence, no control beside the sender. **No `List-Unsubscribe` header, no
`List-Unsubscribe-Post`, no Gmail one-click** — ADR-0019 stands, and tests assert their
absence so adding one later is a deliberate act.

Two link kinds:

- **Production** — a unique token per (campaign, recipient), minted when the message is
  rendered for that recipient.
- **SAFE TEST and preview** — a CONSTANT, inert token (`safe-test-preview-link`). It
  had to be constant: the ADR-0013 approval hash covers the rendered HTML, so a freshly
  minted token per render would change the HTML every time and no approval could ever
  match. It resolves to nothing and unsubscribes nobody, which is also why a test email
  can never touch a customer's settings.

The unsubscribe href now obeys the same deliverability rule as images and the "view as
webpage" link (ADR-0015): a URL that only resolves on the sending machine is dead in a
recipient's inbox, so it falls back to the existing placeholder. **The appearance is
identical either way.**

### 6. One configured public origin, never the Host header

`PUBLIC_APP_URL`. A newsletter is opened on someone else's network, days later, so the
link cannot be derived from the request that produced it — not the `Host` header, not
the LAN address the sender happened to use. HTTPS and a publicly-reachable host are
required for production; `http://localhost` is accepted only outside production and is
reported as **development only**, which keeps production unsubscribe readiness honestly
BLOCKED until a real hostname exists. No domain was invented.

### 7. Two provider ports, not one

`ProductionEmailProvider` is a **separate interface** from the SAFE TEST
`EmailProvider`. They look similar and are not the same thing: one reaches a single
hard-coded address, the other reaches customers. Sharing an interface would let a
mis-wired registry hand a production adapter to the test path, or the reverse. Two
types make that a compile error.

The only implementation is `DisabledProductionEmailProvider`, and **`send()` throws**.
Returning a benign-looking result would let a dry run be mistaken for a delivery, which
is the exact mistake this milestone exists to prevent. `PRODUCTION_DELIVERY_ENABLED`
lives in the environment, not the database, so no UI writes it and no role — including
ADMIN — can flip it from a browser.

No vendor was chosen and no account was created. ADR-0004 stays open; the required
capabilities are recorded in the interface and the recommendation is in the milestone
report.

### 8. Recipients come only from an approved final audience

`CampaignRecipient.finalAudienceId` is **required** — a delivery destination with no
provenance is one nobody approved, and making it nullable "just in case" would leave
exactly that hole. The table was empty, so the constraint is real rather than
aspirational.

"Prepare delivery records" is an explicit, separate, dry-run action requiring: a signed-in
actor with `APPROVE_PRODUCTION`, a final audience that is **not stale**, a **valid**
production approval for that exact audience, and **four-eyes satisfied**. It creates
rows `PENDING` — never `READY` — and the state machine has no automatic path out. Rows
are labelled PREPARED / NOT SENT in the UI. No function in the service takes an address,
so "send to this person as well" is unrepresentable rather than merely refused.

### 9. Delivery states extend, they do not rename

`PENDING`, `READY`, `SENDING`, `SENT` and `FAILED` keep their exact meanings — renaming
an established state rewrites the meaning of historical rows. Added: `ACCEPTED`,
`DELIVERED`, `BOUNCED`, `COMPLAINED`, `UNCERTAIN`, `SUPPRESSED`.

Two properties matter more than completeness:

- **`ACCEPTED` is not `DELIVERED`.** A provider taking responsibility is a different
  fact from a recipient's mail server accepting the message, and only a provider event
  may make the second claim.
- **`UNCERTAIN` has no transition back to `READY` or `SENDING`.** No retry loop can be
  written that re-sends it. Reconciliation via the provider (`lookupByIdempotencyKey`)
  is the only correct answer to "we do not know whether it was accepted".

### 10. The veto is re-read at dispatch, not trusted from the snapshot

An approved audience is a statement about the past. Somebody can unsubscribe between
approval and dispatch, and they must not receive the message. `decideDispatch` re-reads
unsubscribe, suppression, address validity, consent and language immediately before
submission.

It is **not** a second eligibility engine: it uses the same `ExclusionReason`
vocabulary and can only ever REMOVE a recipient. An address the approved audience did
not contain has no ledger row to be checked in the first place.

### 11. Bounce and complaint are different facts

- **Hard bounce** → suppress + mark `emailStatus = INVALID`. The mailbox does not
  exist, and staff need to see that as a data-quality problem to fix in Monday.
- **Complaint** → suppress, and **do not** mark invalid. Someone who reports spam has a
  working mailbox; corrupting `emailStatus` would destroy the signal it carries.
- **Soft bounce** → nothing. A full mailbox is temporary.

Both suppressions **outrank a GRANTED consent**. Consent says AXIS may write; a
complaint says this person does not want to be written to. Ingestion is idempotent by
`providerEventId`, because every provider re-delivers webhooks.

There is **no public webhook route yet**. An endpoint that accepted unsigned events
would let anyone on the internet suppress AXIS customers. The internal handler contract
exists; the route appears with the vendor that can sign it.

### 12. `mustChangePassword` is now enforced

An account carrying an administrator-issued password holds **no capability at all**:
`can()` returns false, `assertCan` throws a distinct `PasswordChangeRequiredError`, and
`requirePage` redirects every route to `/change-password`. They can still sign in —
otherwise they could never reach the screen that unlocks them.

## Alternatives Considered

- **A signed JWT-style unsubscribe token.** Rejected — see §1.
- **Unsubscribe on GET.** Rejected: link prefetchers and scanners would opt people out
  who never clicked.
- **A `List-Unsubscribe` header / Gmail one-click.** Explicitly out of scope. ADR-0019
  chose footer-only and this milestone does not reopen it.
- **Choosing a vendor now.** Rejected: ADR-0004 defers it, and committing without
  evaluating deliverability, RTL rendering and pricing would be a decision made for the
  wrong reason.
- **A production adapter that no-ops instead of throwing.** Rejected — a quiet success
  is precisely how a dry run becomes a real send in someone's memory.
- **Deriving the public origin from the `Host` header.** Rejected: the link is followed
  from a different network, and the header is attacker-controlled.
- **Creating recipients during audience preview.** Rejected: `CampaignRecipient` means
  delivery, and writing it during analysis would make "was this sent?" unanswerable.
- **A shared `EmailProvider` interface for both transports.** Rejected — see §7.

## Consequences

**Positive**

- A recipient can unsubscribe with no account, and the effect is immediate: the address
  leaves every audience, the frozen snapshot goes stale, and the production approval
  bound to it stops being valid.
- The delivery ledger, its provenance, its state machine and its bounce/complaint rules
  exist and are tested, so onboarding a vendor is writing one adapter.
- Production sending is locked by an environment switch no browser can reach, behind a
  provider that throws.
- An administrator-issued password can no longer be used for anything except replacing
  itself.

**Negative / follow-ups**

- **Production unsubscribe is BLOCKED**: `PUBLIC_APP_URL` is `http://localhost:3000`,
  which no recipient can reach. A real HTTPS hostname is a prerequisite for the first
  newsletter.
- **No vendor, no credentials, no authenticated domain.** SPF/DKIM/DMARC are reported
  `NOT_VERIFIED` because they are, and the provider supplies the DNS records AXIS must
  publish once one is chosen.
- **No public webhook route**, so no delivery, bounce or complaint event can arrive yet.
  `Suppression` will not populate itself until it exists.
- The dispatch loop itself — claiming rows, submitting, recording results — is not
  written. The pipeline it will use is, and it is proven by a dry run.
- The unsubscribe throttle is per-process and keyed by a spoofable header, with the same
  limitations recorded in ADR-0023 for sign-in.
- Unsubscribe tokens never expire, deliberately. A link that quietly stopped working is
  worse than no link, and the row can be revoked if one is ever mis-issued.
