# ADR-0013: Microsoft Graph SAFE TEST sending with explicit, hash-bound approval

- **Status:** Accepted — **transport superseded by [ADR-0014](0014-gmail-smtp-safe-test-send.md)** (Gmail SMTP). The approval model, single-use idempotency, uncertainty handling and ledger separation below remain authoritative; only the Microsoft Graph adapter and the `fahed@axis-gps.com` sender are replaced.
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** realises the `EmailProvider` port of ADR-0004; extends ADR-0008 (send-mode gate) and ADR-0012 (test-send surface); consumes ADR-0011 (canonical rendering).

## Context

This is the first milestone in which the platform can put a real message into a real
mailbox. Everything before it was inert. The risk profile changes completely: a bug
here does not produce a wrong pixel, it produces an email that cannot be recalled.

Three specific dangers had to be designed out rather than tested for:

1. **Sending to the wrong person.** Anything that lets a caller name a recipient is a
   path to a customer's inbox.
2. **Sending something other than what was reviewed.** If approval is a boolean, any
   edit between approving and sending silently changes what goes out.
3. **Sending twice.** A double-click, a browser retry, or two tabs must not produce two
   emails, and a button's `disabled` attribute is not a control.

The tenant-side permission model adds a fourth: an application `Mail.Send` grant in
Entra is **tenant-wide**, so the obvious setup gives this application the ability to
send as *any* AXIS mailbox.

## Decision

### 1. Provider behind the existing port

`EmailProvider` (ADR-0004) is realised with `MicrosoftGraphEmailProvider`, the only
code aware of Graph or MSAL. Authentication is app-only client credentials via
`@azure/msal-node` (`acquireTokenByClientCredential`, scope
`https://graph.microsoft.com/.default`), and sending uses
`POST /v1.0/users/{sender}/sendMail` — not `/me/sendMail`, which is meaningless without
a signed-in user. `saveToSentItems: true` so the first test can be verified by hand
without granting any mail-read permission.

### 2. The audience is unrepresentable, not merely validated

`TestEmailMessage` has **no `from`, no `cc`, no `bcc`, no `replyTo`**, and `to` is a
single string rather than a list. The sender comes from adapter configuration. A caller
therefore cannot express "send to someone else" before any runtime check runs.
`assertSafeTestEnvelope` then re-validates at the service **and** again inside the
adapter, refusing outright (rather than trimming) any attempt to widen the audience.

### 3. Approval is bound to a hash of the exact message

An approval authorizes one rendered message, not "this campaign". At approval time a
SHA-256 is taken over a deterministic, length-prefixed canonical payload covering
campaign, send mode, sender, recipient, subject, preheader, ordered content selection,
HTML, and text. At **send** time the newsletter is re-rendered, re-hashed, and compared.
Any difference — a reorder, an edited article body, a changed image — returns
*"Newsletter changed after approval. Please review and approve again."* and sends
nothing. A client-supplied `approved=true` is never consulted.

Preview and send both render through `previewDocument`, so the reviewed message and the
hashed message are byte-identical by construction.

### 4. Single use enforced by the database

`CampaignTestSend.approvalId` is a **UNIQUE** foreign key to `CampaignTestApproval`, and
the attempt row is written **before** the provider is called, inside a transaction that
also claims the approval (`consumedAt`). A concurrent or double-submitted request loses
that race at the database and never reaches Microsoft. Approving again revokes any
previous unused approval, so two live approvals cannot coexist.

### 5. 202 means accepted, not delivered

Graph returns `202 Accepted`. The ledger state is `ACCEPTED` and the UI says
*"Microsoft 365 accepted the test email for delivery"* — never "delivered". A network
error or timeout yields `UNCERTAIN`, which is **never auto-retried**: Microsoft may
already have accepted the message, so retrying risks duplicate mail. Resolution is a
human checking Sent Items.

### 6. Test sending stays out of the production ledgers

Attempts are recorded only in `CampaignTestSend`. `CampaignRecipient`,
`CampaignRecipientSource` and `CampaignEvent` are untouched — the test path has no
audience resolution and no fan-out.

### 7. Configuration is validated for shape, not just presence

A placeholder such as `MICROSOFT_TENANT_ID="xxx"` is *set* but unusable. The capability
check validates GUID/domain and secret shape, so the UI reports
*"Microsoft email provider is not configured"* honestly instead of failing with an
opaque Graph error at send time. The check never calls Graph.

### 8. Tenant permission is documented as narrow, and treated as untrusted

`docs/microsoft-graph-setup.md` prescribes Exchange Online **RBAC for Applications**
(`New-ManagementScope` + `New-ManagementRoleAssignment -CustomResourceScope`) to limit
the application to `fahed@axis-gps.com`, and warns explicitly that a bare Entra
`Mail.Send` grant is tenant-wide. The application's own guards remain mandatory
**regardless** of tenant configuration — they are independent of, not a substitute for,
mailbox scoping.

## Alternatives Considered

- **A boolean "approved" flag.** Trivial, and silently sends the wrong content after any
  edit. The whole point of approval is that it refers to something specific.
- **Idempotency by disabling the button / a UI token.** Client-side only; a second tab,
  a replayed request, or a retry defeats it. The unique FK is the actual guard.
- **Auto-retrying an uncertain send.** Would duplicate real mail. Never.
- **SMTP with a mailbox password.** Rejected by the brief and by basic hygiene; this
  application must never hold a mailbox password.
- **Delegated authentication (`/me/sendMail`).** Requires an interactive user sign-in
  and is wrong for a server-side scheduled sender.
- **Storing the rendered HTML on the approval instead of a hash.** Larger rows for no
  gain; the hash is sufficient to prove identity and re-rendering is cheap and
  deterministic.

## Consequences

- What was reviewed is provably what is submitted, or nothing is submitted.
- One approval can produce at most one Microsoft submission, enforced by PostgreSQL.
- No customer address can be reached: the type has no field for one, two guards reject
  one, and no audience is ever resolved.
- Cost: every test send needs two deliberate clicks, and any edit invalidates approval —
  intentional friction on the one action that cannot be undone.
- Images referenced by `localhost` URLs will not load in a remote Outlook client. This
  is detected and reported in the UI rather than glossed over; hosting images publicly
  is a separate, deliberate decision.
- `@azure/msal-node` is a new dependency, justified as the vendor's supported client for
  token acquisition.
