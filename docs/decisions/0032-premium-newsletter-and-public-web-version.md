# ADR-0032 — Premium newsletter layout and a hosted public web version

- **Status:** Accepted
- **Date:** 2026-08-24
- **Refines:** [ADR-0011](0011-canonical-email-rendering.md) (one rendering path) and [ADR-0015](0015-newsletter-visual-redesign.md) (editorial layout)
- **Does NOT change:** sending, audience, consent, unsubscribe prominence, QA caps

## Context

The newsletter rendered correctly but read as functional rather than considered: a
30px hero barely larger than body copy, 40px gutters, full-width rules cutting the
page into strips, and a pill CTA that looked consumer rather than corporate.

Separately, `viewInBrowserUrl` came from `BRAND_VIEW_IN_BROWSER_URL` — **one configured
URL, identical for every newsletter**. A link promising "this message on the web" that
opens something else is worse than no link, and there was no page behind it at all.

## Decision

### 1. Proportion, not identity

The palette keeps AXIS's blue. What changed is rhythm:

| | Before | After |
| --- | --- | --- |
| Hero headline | 30px | **38px** (28px mobile) |
| Secondary heading | 20px | 21px |
| Gutter | 40px | **48px** (24px mobile) |
| Hero lead | 16px | 17px, looser leading |
| CTA radius | 28px pill | **4px**, larger padding |
| Rules | full width | **inset**, one shade lighter |

The hero is now nearly twice a secondary heading. That gap is the whole point of a
featured article: a flat scale reads as a list.

Type sizes and the gutter live in `TYPE` and `GUTTER` constants rather than scattered
through the markup, so the proportions are one readable decision.

Everything remains table-based with inline styles, `bgcolor` on the CTA so Outlook
paints the fill it cannot round, and one mobile gutter value so the rhythm survives
narrowing.

### 2. "View as webpage" is per-newsletter, or absent

`Campaign.publicToken` — 32 CSPRNG bytes, base64url, carrying no data. The URL is
`{PUBLIC_APP_URL}/n/{token}`.

Stored in **plaintext**, unlike the unsubscribe token. The difference is what the token
authorises: unsubscribe changes state and is therefore hashed, while this grants read
access to content meant to be public — and the same URL must be reproducible on every
render, which a hash cannot do.

The link is rendered **only when it would work**: no token, or an origin a recipient
could not reach, and the row is omitted entirely. It obeys the same deliverability rule
as images (ADR-0015), because a newsletter is opened days later on somebody else's
network.

It sits above the masthead in small muted type with a hairline underline — present for
anyone who needs it, quiet enough to ignore.

### 3. The public page shows the newsletter and nothing else

`/n/[token]` is public in `src/proxy.ts`. It renders the **same** `renderNewsletterHtml`
output inside a `sandbox`-ed iframe with no `allow-scripts`, so the promise the link
makes is literally true.

`getPublicNewsletter` selects only what the document needs. There is no path from it to
status, audience, recipients or audit data, and the page carries no navigation and no
controls. Malformed, unknown and tampered tokens produce the **identical** page, so it
never becomes an oracle for which newsletters exist. `robots: noindex`.

The TEST banner is never shown there: it is an internal signal about configuration, and
this page is what a recipient sees.

### 4. Existence and reachability are reported separately

The preview screen originally had two states — a link, or "no web version yet". That
is a two-state UI over a three-state world: a web version can EXIST while the
configured origin is one no recipient could reach, which is the normal situation on a
development machine. The screen said "no web version yet" about a newsletter that had
one, hiding the page the operator had just created.

`getPublicPageState` therefore returns `enabled`, `emailUrl` and `inspectUrl`
separately. `emailUrl` obeys the deliverability rule and is what a message may carry;
`inspectUrl` is the address that opens for whoever is at the machine and is **never**
rendered into an email. A test asserts that second half, because the whole value of
the rule is that nothing routes around it.

### 5. "Reachable" means publicly reachable, not merely non-loopback

The deliverability gate originally refused only `localhost`, `127.0.0.1`, `0.0.0.0`
and `[::1]`. A private LAN address such as `http://192.168.1.20:3000/n/<token>`
therefore passed, and would have been printed into a real message — dead for every
recipient outside the office, and a free disclosure of the internal network layout.

`isDeliverableImageUrl` now refuses the whole private space: RFC1918, link-local
(including the `169.254.169.254` metadata address), CGNAT `100.64/10`, IPv6 ULA and
link-local, IPv4-mapped IPv6 forms, `.local`/`.internal`/`.lan`, and bare intranet
labels with no dot at all. The check is written as a list of named patterns rather
than one regex, because each entry is a separate claim about what a recipient cannot
reach. It governs images and the web-version link alike — the reasoning is identical.

## Consequences

- The email reads as a designed marketing newsletter; verified by screenshot at desktop
  and mobile, and by a browser test that **measures** the rendered hero against body copy.
- Enabling or disabling a web version changes the email HTML and therefore invalidates
  an existing SAFE TEST approval. That is correct — the message changed.
- `BRAND_VIEW_IN_BROWSER_URL` is now unused and deprecated.
- The unsubscribe footer is untouched: one small link, same place, no `List-Unsubscribe`.
- The layout was reviewed in real inboxes on 2026-08-24 by eight internal QA messages
  (ADR-0027 channel, 28/40 lifetime). The email carried no "View as webpage" link,
  correctly, because the development origin is not recipient-reachable.
- The link itself was then proven end to end by ONE further QA message (29/40) sent
  while a short-lived HTTPS tunnel gave the local build a public origin. That tunnel is
  a QA instrument, not an architecture: the hostname is ephemeral, so a link printed
  into a message outlives the origin it points at. It is acceptable for a message a
  colleague opens within the hour and unacceptable for anything a customer keeps.

## Alternatives considered

**Keep the single configured URL.** Rejected — it cannot be true for more than one
newsletter.

**Use the campaign id in the public URL.** Rejected: it would let anyone enumerate
campaigns, including drafts.

**Inject the newsletter HTML into the page instead of an iframe.** Rejected — the
newsletter is a complete document with its own `<html>`, styles and direction. `srcDoc`
preserves all of it, and the sandbox means nothing in it can execute.

**Show a greyed-out link when no page exists.** Rejected. A control that looks like a
link and does nothing is worse than its absence.
