# ADR-0026 — Content sources, the review inbox, and assisted newsletter automation

- **Status:** Accepted
- **Date:** 2026-08-20
- **Implements:** the ASSISTED automation and external-content model of [ADR-0010](0010-newsletter-automation-and-content.md)
- **Builds on:** [ADR-0012](0012-authoring-media-and-safe-test-send-ui.md), [ADR-0016](0016-cloudinary-image-hosting.md), [ADR-0023](0023-authentication-and-four-eyes-enforcement.md)
- **Amends:** the "ADMIN adds exactly one capability" statement of ADR-0023 (see §7)

## Context

ADR-0010 declared that a newsletter composes many reviewed content items and that
recurring automation is ASSISTED — it prepares a draft and never sends. The models
existed (`ContentSource`, `ContentItem`, `ContentIngestionRun`, `NewsletterAutomation`,
`NewsletterAutomationRun`), but nothing filled them: articles were typed in by hand and
`/automations` was a placeholder.

Filling them means the server fetches URLs that a person supplied. That is not an
incidental detail — it is the definition of SSRF, and this server sits inside AXIS's
network. So the decision below is as much about what the platform refuses to fetch as
about what it collects.

## Decision

### 1. Feeds only. This is not a crawler.

v1 reads declared **RSS 2.0 and Atom 1.0** feeds, plus a `MANUAL_EXTERNAL` kind for an
article a person adds by hand. There is no crawl depth, no link-following, no
link-discovery toggle and no HTML scraping — and the absence of those options is the
control. A publisher who offers a feed is telling us what they want syndicated; a
crawler decides for them.

### 2. SSRF defence in two halves, both required

`domain/content/sourceUrl.ts` (pure) judges a URL's SHAPE: public `http(s)` only, no
credentials, standard ports only, and refusal of loopback, RFC1918, link-local, CGNAT,
private IPv6 **including the IPv4-mapped forms** (`::ffff:127.0.0.1`), internal
hostnames, bare labels, and the cloud metadata endpoints by both address and name.

`server/integrations/content/feedFetcher.ts` is the ONLY place a source is fetched. It
adds what a pure function cannot know: it **resolves DNS and re-checks every resolved
address**, follows redirects **manually, one hop at a time, re-validating each hop**,
caps the body **while streaming** (a `Content-Length` header is a claim), times out, and
checks the content type. It sends no cookies, no `Authorization`, no AXIS identity.

Shape-checking alone is insufficient — a public name can resolve to `10.0.0.5` — and
`redirect: "follow"` would hand the decision to undici, which is the standard way past a
front-door-only check. Both halves, or neither works.

### 3. A purpose-built feed reader, not a general XML parser

`domain/content/feedParser.ts` extracts a fixed set of elements. It **refuses any
document containing a DOCTYPE or ENTITY declaration** and has no concept of resolving
one, so XXE and entity-expansion bombs have nothing to attack. That is a stronger
guarantee than configuring a general parser safely and hoping nobody reconfigures it —
and it avoided adding an XML dependency for a job this size.

### 4. Collected is never usable

Every ingested item is created **`PENDING_REVIEW`**. There is no branch, flag or
configuration that creates one `APPROVED`. Only `approveContent` / `rejectContent` move
it, both demand a signed-in actor, and both write an audit row naming them.

### 5. Deduplication is conservative in one direction

Identity is `(source, externalId)` or `(source, normalizedUrl)`, both **UNIQUE in the
database** — so idempotency is the index, not a check that could race. The normalized
form drops scheme, `www.`, default port, fragment, and campaign tracking parameters,
and sorts the rest; it **keeps** parameters like `?id=12`, which very often *are* the
article.

It **never merges on resemblance**. Two publishers covering the same launch are two
articles, and AXIS may legitimately link either. Similar titles are not a signal.

Identity is scoped **per source**: a syndicated copy is a different source's article.

### 6. Source metadata and AXIS editorial copy are separately owned

Mirrored from the publisher: `title`, `summary`, `author`, `externalUrl`,
`publishedAt`. Written by AXIS: `axisHeadline`, `axisSummary`, `ctaLabel`, `ctaUrl`,
`internalNote`. `saveEditorial`'s update payload contains ONLY the second set, so it
cannot rewrite what the publisher said or decide that an article is approved — the same
shape that keeps language and consent from reaching each other (ADR-0020/0021), and for
the same reason: a re-collection must refresh the left column without destroying the
words a colleague wrote.

**Only a title, a short source-supplied excerpt and a link are stored.** The excerpt is
truncated at ingestion, Atom `<summary>` is preferred over `<content>` because the
latter is often the whole article, and the newsletter links readers to the original.

### 7. Adding a source is an ADMIN act

`MANAGE_CONTENT_SOURCES` is ADMIN-only. Reviewing and approving ARTICLES is ordinary
editorial work and stays with MANAGER.

This **amends ADR-0023's "ADMIN adds exactly one capability"**. The invariant that
statement protected is intact and is now tested directly: nothing an administrator holds
alone can approve, send, or choose who receives an email. Both admin-only capabilities
are infrastructure — who may sign in, and which external URL this server may fetch.

### 8. Automation prepares a draft, and cannot do anything else

`runAutomation` collects, then drafts **only from content a person already approved** —
articles ingested by that very run are `PENDING_REVIEW` and therefore unusable by it, so
a brand-new automation's first run legitimately reports `NO_CONTENT`.

The draft is a `Campaign` in `DRAFT` with ordered `CampaignContentItem` rows, **no
segment**, no final audience, no `CampaignRecipient`, no approval. A test asserts
against the source that `automationService.ts` contains no reference to either provider
registry, to `dispatchCampaign`, or to `campaignRecipient`.

**An occurrence happens once**: `@@unique([automationId, scheduledFor])` means a
double-click, a retry or two workers collapse into one run, decided by the database.

**A missed occurrence is still due** — a late draft harms nobody. This is deliberately
the opposite of ADR-0010's rule for a scheduled SEND, which does not go out late.

**"Nothing new" is `NO_CONTENT`, reported as a plain sentence.** Showing a quiet week as
a failure trains people to ignore failures.

### 9. One failing source is one failing line

Each source is fetched, parsed and committed independently; the batch is `PARTIAL`.
Diagnostics are friendly text — never a stack trace, and never an internal address, even
in a run log.

### 10. Images are imported only on request

An external image URL is recorded so a reviewer can see the thumbnail, but importing it
into the `MediaStore` is an explicit human action, with the same guards as an upload:
public URL, size cap, and **magic-byte sniffing** (SVG has no magic number here and is
refused). Hot-linking would break the newsletter the day the publisher reorganises their
CDN; importing everything automatically would be both rude and expensive.

### 11. No AI

No AI provider exists in this platform and this milestone does not add one. Subject and
preheader suggestions are mechanical string operations over the featured article's
title. If generated copy is ever added it must be DRAFT text requiring human review, and
it needs its own ADR.

## Consequences

- AXIS can define sources, collect articles, review them, write its own copy, and build
  a multi-item draft — the workflow ADR-0010 described, now real.
- The server makes outbound requests it did not before. That is confined to one file
  with every guard in it, and covered by tests that name each attack.
- **A defect was found while running the suite:** with real Resend credentials now in
  `.env.local`, the provider registry resolved to the LIVE adapter inside the test
  runner. The registry now refuses to construct a network-capable adapter under
  `VITEST`/`NODE_ENV=test` for BOTH ports, and the SAFE TEST port resolves to a
  transport that throws. A test can no longer send anything, on any machine.
- Production delivery and the provider pilot are untouched and remain locked.

## Alternatives considered

**A general XML parser dependency.** Rejected for a job this size: a purpose-built
reader that cannot resolve entities is a stronger guarantee than a general parser
configured correctly, and it added no dependency.

**Auto-approving content from "trusted" sources.** Rejected. Trust in a publisher is not
consent to put their words in an AXIS newsletter unread, and the whole value of the
review inbox is that a person saw it.

**Letting an automation assemble a draft from newly-collected articles.** Rejected —
it would make the run useful immediately and would mean unreviewed external content
entering a newsletter. `NO_CONTENT` on the first run is the correct trade.

**Allowing MANAGER to add sources.** Rejected per §7. A manager can still add an article
by hand and can run a check at any time.

**Blocking sources by a list of known-bad hosts.** Rejected: block-lists fail open. The
rule is an allow-list of shapes, plus a check of what the name actually resolves to.
