# ADR-0019: No-reply newsletter behaviour

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Relates to:** extends ADR-0013 (hash-bound approval) and ADR-0014 (Gmail SMTP transport).
  Deliberately does **not** change ADR-0008 (unsubscribe) or ADR-0015 (footer design).

## Context

Newsletters are sent from the authenticated Gmail mailbox `axisgpscana@gmail.com`. Anyone who hits
Reply in Gmail or Outlook currently writes back into that mailbox, which is a sending account, not a
support inbox. Replies there would be missed.

The email client's Reply button belongs to the client. It cannot be removed, hidden, or disabled by
the sender — any claim otherwise would be false. What the sender *can* control is where a reply is
addressed.

## Decision

### 1. `Reply-To: noreply@axis-gps.com`, set from central configuration

`NEWSLETTER_REPLY_TO` (default `noreply@axis-gps.com`) is resolved by `getSenderIdentity()` in
`server/integrations/email/senderIdentity.ts` — the single resolution point, called by **both** the
service that hashes the approved message and the SMTP adapter that submits it. One source, so what
was approved and what is sent cannot drift apart.

The authenticated sender is unchanged. Gmail sends as the account that signed in; only the reply
destination moves.

### 2. It is configuration, not a newsletter field

There is no UI input, no form value, and no service parameter for the reply address. The
`TestEmailMessage` type still has **no** `from`, `cc`, `bcc`, or `replyTo`, and
`assertSafeTestEnvelope` still refuses any caller-supplied `replyTo` outright. A hostile caller
passing `replyTo` alongside a valid message changes nothing — proven by test.

### 3. Refused, not repaired

`validateReplyTo` accepts exactly one plain address. An array, a comma- or semicolon-separated list,
a `Name <addr>` form, or any control character is rejected. Injection is checked on the **raw**
string *before* trimming: trimming a trailing newline first would hide exactly the attack the check
exists for.

A malformed value makes test sending **unavailable** — reported as a configuration problem — rather
than silently falling back to the default. Silently substituting a different reply address than the
one configured is precisely the failure mode worth refusing.

### 4. Reply-To is part of the approved message

`replyToEmail` and `senderName` joined the canonical approval payload, so changing either changes
the SHA-256 and invalidates an existing approval: preview → approve → send again. The approval row
also records `replyToEmail`, and `checkApproval` compares it as an independent second gate (a
`WRONG_REPLY_TO` rejection) in case the hash ever stops covering it.

Single-use approval and the UNIQUE `CampaignTestSend.approvalId` idempotency are untouched.

### 5. From shows the AXIS display name

`"AXIS Advanced Mapping Solutions" <axisgpscana@gmail.com>`. The display name is a code constant and
is injection-checked like an address — a control character or an embedded quote in a display name
forges a header just as effectively as one in an address.

### 6. Unsubscribe is deliberately NOT touched

No `List-Unsubscribe` header. No `List-Unsubscribe-Post`. No Gmail one-click unsubscribe. No
unsubscribe control near the sender, and no change to the footer link's size or prominence.
Unsubscribe stays a single modest link in the footer, exactly as ADR-0008 and ADR-0015 left it.

This is enforced by tests asserting the *absence* of those headers and of a second unsubscribe
occurrence, so adding them later has to be a deliberate, visible act rather than a quiet drift.

### 7. A real contact method stays in the footer

`info@axis-gps.com` remains in the footer as the way to reach AXIS, and the send panel states
plainly: *"Replies to this newsletter are not monitored."* Directing replies to an unread mailbox
without offering a real alternative would be worse than the original problem.

## Alternatives Considered

- **Sending from `noreply@axis-gps.com` directly.** Rejected — Gmail sends as the authenticated
  account, so this would require a different mailbox and new credentials, and would break the
  hard-coded authorized-sender guard that keeps test sends safe.
- **Adding `List-Unsubscribe` while we were in the headers anyway.** Explicitly rejected: the brief
  requires unsubscribe to stay footer-only and subtle. Gmail's one-click unsubscribe also needs the
  public tokenized endpoint, which does not exist yet.
- **A per-newsletter reply address.** Rejected — it is a policy decision, not editorial content, and
  a per-newsletter field is a per-newsletter way to get it wrong.
- **Silently falling back when `NEWSLETTER_REPLY_TO` is malformed.** Rejected — the approver would
  have reviewed one reply address while a different one was used.

## Consequences

- Replies to AXIS newsletters are addressed to `noreply@axis-gps.com` instead of the sending
  mailbox. Whether that address bounces or is silently discarded is a mail-domain decision outside
  this platform; the footer contact address is the supported route either way.
- Every approval created before this change is now invalid, because the hash covers two new fields.
  The UI already says "Newsletter changed after approval — review and approve again", which is the
  intended path.
- Two nullable columns were added (`replyToEmail`, `senderName` on `CampaignTestApproval` and
  `CampaignTestSend`) so the audit trail records what was actually approved and submitted.
- `NEWSLETTER_REPLY_TO` is documented in `.env.example`. It is not a secret.
