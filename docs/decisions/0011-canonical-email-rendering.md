# ADR-0011: One canonical newsletter rendering path

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** implements the rendering half of ADR-0010 (multi-content composition); consumed later by the provider adapter of ADR-0008 (safe-send).

## Context

AXIS staff must be able to see exactly what a newsletter will look like before anything is sent. The
obvious shortcut — build a nice-looking React preview now and write the "real" email HTML later when a
provider is wired up — produces two divergent layouts. The preview then stops being evidence: staff
approve one thing and customers receive another. That divergence is the single most likely way this
platform sends something embarrassing.

Email rendering is also a hostile target. Email clients (Outlook in particular) ignore `<style>`
blocks, external stylesheets, flexbox, grid, and CSS classes. Tailwind utility classes do not survive
into a sent message at all. Newsletters must additionally render **right-to-left** for Hebrew and
Arabic, including mixed LTR fragments (product codes such as `GPS-3000`, URLs) inside RTL text.

## Decision

1. **Exactly one email HTML generator exists:** `renderNewsletterHtml(doc)` in
   `src/domain/email/newsletterTemplate.ts`. The browser preview and any future provider adapter call
   the same function with the same `NewsletterDocument`. There is no "preview-only" layout, and adding
   one is a defect.
2. **The renderer is pure and deterministic.** It lives in `domain/` (no I/O, no framework imports),
   and identical input yields byte-identical output — no timestamps, no randomness. This makes the
   output testable and diffable.
3. **Email-safe markup only:** table-based layout with `role="presentation"`, inline styles on every
   element, absolute image URLs, and a `<meta viewport>`. A `@media` block exists strictly as
   progressive enhancement; every layout-critical style is also inline.
4. **RTL uses real direction semantics.** `dir` is set on `<html>` and on each content table
   (`directionFor(language)`), which is what makes bidirectional text, punctuation, and embedded LTR
   fragments behave. Text alignment is derived from the direction *in addition to* `dir`, because
   older email clients do not honour `text-align: start`. `UNKNOWN` language stays LTR — never guessed.
5. **The document is assembled from the frozen snapshot when one exists.**
   `buildNewsletterDocument` prefers `CampaignContentItem.snapshot*` over the live `ContentItem`, so
   the preview of an approved newsletter shows what was frozen, not what was edited afterwards.
6. **The unsubscribe block is rendered now**, before the tokenized endpoint exists (ADR-0008). With no
   URL it renders as visible, clearly-labelled placeholder text rather than a broken link, so the
   final layout is reviewable today and gains a working `href` later with no template change.
7. **Preview renders inside a sandboxed iframe** (`sandbox=""`, `srcDoc`) so email CSS cannot leak
   into the admin UI and admin CSS cannot flatter the email. Switching desktop/phone changes only the
   iframe width — never the markup.

## Alternatives Considered

- **React Email / MJML.** Both are good, and both are a new build-time dependency plus a compilation
  step for a template that is currently one file. CLAUDE.md requires dependencies to be justified by a
  proven need; this can be revisited if the template grows several layouts.
- **Render the preview with Tailwind and the email separately.** Rejected — this is precisely the
  divergence the decision exists to prevent.
- **Render preview HTML inline (no iframe).** Rejected: the admin page's own CSS reset and Tailwind
  preflight would alter the email's appearance, making the preview misleading.

## Consequences

- What staff approve in the preview is what a sender would transmit; the preview is evidence.
- The eventual Microsoft Graph adapter consumes `renderNewsletterHtml` + `renderNewsletterText` and
  needs no rendering logic of its own.
- Template changes are covered by unit tests asserting content, ordering, RTL, images, links, footer
  and the absence of recipient data — a regression is caught before it reaches an inbox.
- Cost: hand-written table markup is more verbose than JSX-based email libraries, and broad
  email-client testing (Outlook/Gmail/Apple Mail) still has to happen before the first real send.
