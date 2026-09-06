# ADR-0036 — Mixed-format article adaptation

- **Status:** Accepted
- **Date:** 2026-09-06
- **Amends:** ADR-0012 authoring input and ADR-0026 excerpt normalization.

## Context

The supplied examples show publisher HTML escaped into visible tags in imported
excerpts, with missing images. The previous reader stripped tags before decoding XML
entities, so encoded HTML survived. The ingestion service also discarded declared
image URLs. Staff need to combine ordinary text, formatted copy and HTML in one article.

## Decision

`domain/content/articleFormat.ts` converts bounded input to the existing editable
markup. It accepts plain text, restricted Markdown, HTML fragments, entity-encoded
HTML and mixtures. Rich clipboard HTML and `.txt`, `.md`, `.markdown`, `.html`, `.htm`
files use the same conversion as server-side saves. Conversion runs again on the
server; raw client HTML is never trusted as rendered output or persisted as body HTML.

Use pinned `parse5` 8.0.1 for HTML fragment parsing. This is a concrete exception to the
domain's dependency-free preference: a deterministic, DOM-free parser with no I/O,
scripts or network. It is not an XML parser, crawler, WYSIWYG editor or HTML passthrough.
Handwritten tag-stripping cannot reliably interpret malformed/nested HTML and entities.

Headings, emphasis, lists, links, quotations and ordered inline pictures become our
own markup. Table rows retain cell order as readable text. Publisher CSS, scripts,
forms, embedded executable content, hidden elements and obvious tracking pixels are
discarded. URLs are checked; relative media uses an explicitly supplied article URL.
Pictures render at a bounded width with automatic height. Existing image uploading
and explicit external-image import remain separate from text conversion.
Explicit image import shares the feed downloader's public-DNS checks and streaming
5 MB cap, refuses redirects, and still checks image bytes before storing an asset.

Feed excerpts are decoded and cleaned **before** the 600-character limit. RSS/Atom,
CDATA, Atom XHTML and RSS `content:encoded` fallback are supported. Public image
references are retained, including pictures embedded in description HTML. No image
is downloaded automatically. Feeds still store excerpts, never full scraped articles.

Existing library/inbox rows and unfrozen newsletter content receive read-only
presentation normalization. AXIS editorial headline, summary and CTA take precedence
in newsletter composition while source metadata remains separately owned. A stored
dispatch document and content snapshots take precedence over live conversion. Rendered
message changes invalidate existing hash-bound approvals through the existing checks.
The canonical renderer remains shared by preview and sending; new documents include
the normalized body in the plain-text alternative too.

## Limits and consequences

- Import files are capped at 200 KB; server raw input at 200,000 characters, normalized
  article body at 50,000 characters. Tree depth/node count and picture count are bounded.
  Overly large/complex authoring input is refused rather than saved partially.
- This does not add PDF, DOCX, RTF, JSON Feed, video playback, arbitrary file uploads,
  translation, website crawling or full-article downloading. Text copied from document
  editors works when the clipboard supplies text/HTML. Embedded binary pictures need
  the image uploader.
- An old excerpt truncated before this repair cannot recover text that was never stored.
- No schema migration, operational data rewrite, source polling or email sending is
  needed to activate the presentation correction.

## Validation

Unit coverage exercises encoded publisher fragments, mixed content, malformed HTML,
multilingual text, media/link vetoes, tracking pixels and bounded input. Integration
coverage checks persisted editable source, real newsletter output, source preservation,
editorial precedence, unchanged frozen documents and zero recipient rows. Browser
coverage verifies import/paste, save/reload and newsletter preview.
