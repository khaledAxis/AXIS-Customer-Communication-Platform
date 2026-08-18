# ADR-0015: Editorial newsletter layout, bidi isolation & omission of non-deliverable images

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Relates to:** redesigns the renderer of [ADR-0011](0011-canonical-email-rendering.md) (single canonical path unchanged); preserves the SAFE TEST flow of ADR-0013/ADR-0014 untouched.

## Context

The MVP template was structurally correct but visually thin: uniform article blocks, no
hierarchy, a plain footer. AXIS supplied a professional B2B newsletter as a style
reference and asked for a comparable level of polish under AXIS branding.

Two problems surfaced while implementing it that mattered more than the styling:

1. **Bidi punctuation drift.** In a Hebrew email, `GPS, Mapping & Field Technology`
   rendered as `Mapping & Field Technology ,GPS` — the comma is a neutral character, so
   with the Latin words in separate runs it migrated to the RTL edge. Product codes,
   URLs and the brand name are exactly the strings AXIS customers must be able to read.
2. **Localhost images.** Development images resolve to `http://localhost:3000/...`.
   Previously the email embedded them and the UI merely warned; a recipient would have
   received broken image boxes.

## Decision

### 1. Editorial layout, one renderer

`renderNewsletterHtml` is redesigned, not duplicated. Structure: optional utility row →
AXIS wordmark header → featured hero image → blue uppercase kicker → large headline →
lead/summary/body → pill CTA → divider → secondary articles → centred footer. 640px
centred container, light-grey canvas, white card, generous padding, one accent blue.

**The first included item is automatically the featured article** (hero image, `<h1>`,
kicker, pill CTA); the rest render as compact `<h2>` blocks with a text link. No new
field or editorial decision is required from the user to get hierarchy.

### 2. Non-deliverable images are OMITTED, not embedded

`deliverableImageUrl()` returns null for any URL that is not `http(s)` or whose host is
`localhost` / `127.0.0.1` / `0.0.0.0` / `[::1]`. The layout closes up; no broken image
box ever reaches a recipient. The same rule guards the "View as webpage" link, which
would otherwise be a dead link in the inbox.

**Preview and send share this omission.** The brief permitted showing the local image in
preview and stripping it on send, but that divergence would let someone approve a layout
with pictures and send one without — precisely the "approve one thing, send another"
failure the ADR-0013 approval hash exists to prevent (the hash is taken over the rendered
HTML). Instead the preview shows the truth and the page states how many pictures were
left out and why. Once images are served from a public base URL they are included
automatically, with no code change.

### 3. Latin phrases are isolated for bidi, as whole phrases

`escapeWithLtrIsolation()` wraps contiguous Latin runs — including the spaces, commas and
ampersands *between* Latin words — in `<span dir="ltr">`. Isolation runs on the raw text
*before* escaping, so an entity such as `&amp;` can never be split. Whole-phrase
isolation is what fixes the punctuation drift; per-word isolation leaves every separator
neutral and does not.

`dir="ltr"` (the attribute) is used rather than `unicode-bidi: isolate`, because Outlook's
Word rendering engine honours the attribute and not the CSS property.

### 4. Outlook-safe construction

Table layout with `role="presentation"`, inline styles on every element, `Arial,
Helvetica` stack, `X-UA-Compatible`, explicit `color-scheme: light` so dark mode degrades
predictably, and `bgcolor` on the CTA cell so Outlook paints the fill even though it drops
`border-radius` (the button degrades to a square — acceptable). No web fonts, no flex, no
grid, no absolute positioning. The `@media` block is progressive enhancement only.

### 5. AXIS branding only

The reference newsletter informed structure, spacing and hierarchy. No logo, wording,
footer text or asset from it is reproduced. The wordmark is a text-based AXIS block —
no logo asset is required, and one can replace it later without touching the layout.
Social links, privacy/terms URLs and the address line are optional configuration and are
omitted entirely when unset, so the footer never advertises an account that does not exist.

## Alternatives Considered

- **A separate "designed" template for sends.** Rejected: two layouts guarantee drift and
  break the approval hash.
- **Rendering a placeholder box where a local image was dropped.** Rejected: it is visual
  noise in a real email, and it would still differ between preview and send.
- **Unicode isolate characters (U+2068/U+2069).** Better on paper; unreliable across
  Outlook versions, and invisible characters are hard to debug in stored content.
- **An `<img>` logo.** Would need a publicly hosted asset — the exact problem the image
  rule exists to avoid. A text wordmark always renders, including with images blocked.

## Consequences

- The email reads as a professional B2B newsletter with clear hierarchy and a real CTA.
- Hebrew and Arabic newsletters keep product codes, URLs and the brand legible, with
  punctuation on the correct side.
- Recipients never see a broken image; senders are told plainly what was left out.
- Cost: with no public image host, newsletters currently send without pictures. Hosting
  images publicly (or setting `NEXT_PUBLIC_APP_URL` to a reachable origin) restores them
  with no code change — a deliberate, separate decision.
- Changing the template changes the rendered HTML, so **existing approvals are
  invalidated** and must be re-approved. That is the approval system behaving correctly.
