# ADR-0014: Gmail SMTP as the SAFE TEST transport (supersedes the Graph adapter of ADR-0013)

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Supersedes:** the *transport* half of ADR-0013. Everything else in ADR-0013 — hash-bound approval, single use, DB-enforced idempotency, uncertainty handling, ledger separation — is **unchanged and still authoritative**.

## Context

ADR-0013 implemented SAFE TEST sending over Microsoft Graph from `fahed@axis-gps.com`.
That path was never exercised: it needed an Entra app registration, admin consent for a
tenant-wide `Mail.Send` grant, and Exchange RBAC scoping before a single message could
move. The first real email kept waiting on tenant administration.

A Gmail account (`axisgpscana@gmail.com`) with an App Password is already available, so
the test direction becomes `axisgpscana@gmail.com → khaled-s@axis-gps.com` and the first
real message can be sent today.

The important observation: **the transport was the only part that needed to change.**
Because sending sat behind the `EmailProvider` port (ADR-0004), swapping it touched one
adapter and one factory line. No domain rule, service, approval, ledger, or UI behaviour
moved.

## Decision

1. **`GmailSmtpEmailProvider` replaces `MicrosoftGraphEmailProvider`** as the single
   registered adapter. Nodemailer over `smtp.gmail.com:465` with implicit TLS
   (`secure: true`), authenticating with a Google **App Password** — never an account
   password, which this application must never hold.
2. **The Graph adapter is removed rather than left dormant.** Two adapters hard-coding
   different senders cannot both be correct against one `AUTHORIZED_TEST_SENDER`, and a
   dormant second send path is a liability if a factory line is ever changed. It remains
   recoverable in git (commit `8eaaaec`) if Microsoft 365 is revisited.
3. **Authorized addresses stay hard-coded constants**: sender `axisgpscana@gmail.com`,
   recipient `khaled-s@axis-gps.com`. `SAFE_TEST_SENDER` / `SAFE_TEST_RECIPIENT` in the
   environment are **cross-checked against** those constants, never read as the source of
   truth. A mismatch makes sending *unavailable*; it can never redirect an email. This is
   deliberate: an env-configurable recipient would be a route to a customer's inbox.
4. **`GMAIL_SMTP_USER` must equal the authorized sender.** Gmail sends as the
   authenticated account, so a mismatch would silently send from a different mailbox.
   That is a configuration error, reported as not-configured.
5. **Header/newline injection is refused, not sanitized.** Any control character in an
   address or subject can forge extra SMTP headers (a smuggled `Bcc:`), so
   `hasHeaderInjection` rejects such values outright. It is written as a code-point scan
   rather than a regex so the check is unambiguous.
6. **Configuration validation checks shape, not just presence.** A 16-character App
   Password is required; anything else is an account password or a placeholder and would
   fail confusingly at send time. Spaces are stripped, since Google displays the password
   in four groups.
7. **`verifyConnection()` performs an SMTP handshake plus AUTH and sends nothing.** It is
   available on demand and is never run on page load; the routine capability check is
   purely local.
8. **SMTP 250 is `ACCEPTED`, not delivered.** A broken connection or unreadable result is
   `UNCERTAIN` and is **never auto-retried** — Gmail may already have accepted the
   message. A human checks the Sent folder.

## Alternatives Considered

- **Keep Microsoft Graph and wait for tenant administration.** Correct long-term for an
  AXIS-domain sender, but it blocks the first real test indefinitely on work outside this
  project. Recoverable from history when that milestone arrives.
- **Run both adapters and select on `EMAIL_PROVIDER`.** Rejected for now: a second live
  send path with a different hard-coded sender doubles the surface that must be correct,
  for no benefit while only one is configured.
- **SMTP with the plain Gmail account password.** Rejected outright — an account password
  grants full account access and cannot be scoped or revoked independently.
- **Reading the recipient from `SAFE_TEST_RECIPIENT`.** Rejected: it would make a
  customer address reachable by editing a file. The env var is a cross-check only.

## Consequences

- The first real AXIS test email can be sent today, through the browser, by a human.
- The port abstraction proved its value: a full transport swap changed one adapter, one
  factory line, and provider-specific wording — no domain, approval, ledger, or UI logic.
- Gmail is a **test** transport only. Per-account daily limits and consumer-domain
  deliverability make it unsuitable for customer newsletters; production bulk sending
  still needs the ADR-0004 provider with SPF/DKIM/DMARC aligned to an AXIS domain.
- Mail now sends from a `gmail.com` address rather than an AXIS domain, so the test
  message will not carry AXIS domain authentication. Acceptable for a single test to a
  known recipient; not acceptable for customers.
- `@azure/msal-node` is removed; `nodemailer` is added.
