# ADR-0012: Content authoring, image storage & the SAFE test-send surface

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** ADR-0008 (send-mode gate / safe-send), ADR-0010 (content model), ADR-0011 (canonical rendering).

## Context

The first user-facing milestone gives AXIS staff a browser workflow: write articles, add pictures,
compose a multi-article newsletter, and preview it. Three decisions in that workflow carry real risk:

1. **Rich text.** Whatever staff write ends up inside an email. Storing client-supplied HTML means
   accepting an XSS vector and depending on a sanitizer being correct forever.
2. **Images.** Uploads are untrusted binaries. Naive handling invites path traversal, content-type
   confusion, and serving an uploaded file as executable HTML.
3. **Test sending.** The UI must show a test-send surface before a provider exists, without creating
   any route by which mail could actually leave, and without letting an arbitrary recipient be entered.

## Decision

### 1. Restricted markup, rendered server-side — no stored HTML

Staff write a small markup (headings, bold, italic, links, bullet/numbered lists) in a toolbar-driven
editor. **The server never stores or emits client-supplied HTML.** `renderRichText` escapes the entire
source first and then emits only tags it generates itself, so a hostile payload cannot produce an
element or attribute — XSS-safety is **structural**, not a sanitizer allow-list that can be bypassed.
Link URLs are restricted to `http`, `https`, `mailto`; anything else renders as literal text.

`ContentItem.bodyText` holds the editable source (which doubles as the plain-text alternative, being
readable as-is) and `ContentItem.bodyHtml` holds the server-rendered email HTML. The editor's live
preview calls the *same* pure function, so the author sees the real output.

No rich-text dependency is added. A WYSIWYG library would store arbitrary HTML and reintroduce the
sanitizer problem, and email supports only this small subset anyway.

### 2. Images: validated, renamed, stored outside `public/`, behind a port

- Allow-list of `image/jpeg`, `image/png`, `image/webp`, `image/gif`; **5 MB** ceiling.
- **SVG is rejected in v1** — it is an XML document that can carry script and no sanitizer exists.
- **Magic-byte sniffing:** content must actually be the declared type, so `evil.html` renamed to
  `photo.png` is refused.
- **The client filename never reaches the filesystem.** A storage name is generated
  (`slug-<random>.<ext>`), so traversal, absolute paths, NTFS streams and unicode tricks are
  structurally impossible rather than filtered.
- Files live in git-ignored `var/media/`, **not** `public/`, and are served by a route handler that
  re-validates the name, sets the type from the extension allow-list, and sends `nosniff` plus a
  restrictive CSP — an upload can never be served as HTML or script.
- Access goes through a **`MediaStore` port**; `LocalMediaStore` is the only file that touches the
  filesystem. Production object storage is a second implementation plus one factory line.
- Binary data is **not** stored in PostgreSQL.

### 3. Test-send surface: visible, honest, and inert

- Exactly two addresses are hard-coded in `domain/send/testSendPolicy.ts`:
  sender **`fahed@axis-gps.com`**, recipient **`khaled-s@axis-gps.com`**.
- The UI renders them as **read-only text — the panel contains no input element**, so there is no
  field to submit. Hiding a field is not a control, so `assertAuthorizedTestRecipient` rejects any
  other recipient server-side regardless of what a crafted request contains.
- `testSendAvailability()` currently always returns `canSend: false` with reason
  `EMAIL_PROVIDER_NOT_CONFIGURED`. The button is disabled and explains why. When a provider arrives
  this becomes a real capability check and the UI needs no rework.
- Preview creates **no** `CampaignRecipient`, `CampaignTestSend` or `CampaignEvent` rows, and performs
  no network call. TEST remains the default in code, in the Prisma schema, and in the database column
  default.

### 4. Development author stand-in

`Campaign.createdById` is a required FK and Auth.js is a later milestone, so newsletters are attributed
to a single clearly-labelled local user (`dev-local@axis-gps.invalid`). It is replaced by the real
session user when authentication lands — not extended.

## Alternatives Considered

- **TipTap / Lexical / Quill + DOMPurify.** Better authoring UX, but stores arbitrary HTML and makes
  email safety depend on sanitizer correctness. Revisit if authoring needs outgrow the subset.
- **Serving uploads from `public/`.** Simplest, but removes the ability to re-validate the name and
  pin the content type, and makes every uploaded byte publicly addressable.
- **Storing images as `bytea` in PostgreSQL.** Rejected: bloats backups and the row store for no gain.
- **An enabled test-send button that returns "not implemented".** Rejected: a live button implies a
  send path exists. Disabled + an explanation is honest and leaves no route to fire.

## Consequences

- Email HTML cannot carry injected script, by construction rather than by vigilance.
- Uploaded files cannot escape `var/media/` or be served as executable content.
- No email can be sent from the application in this milestone — verified by tests and by the absence
  of any provider dependency, transport code, or outbound endpoint.
- Cost: the editor is a markup-with-toolbar rather than true WYSIWYG; authors see markers such as
  `**bold**` in the source pane, mitigated by the always-visible live preview.
- Adding English later requires a schema change: `Language` is `HE | AR | UNKNOWN` only, and was
  deliberately **not** widened for UI convenience.
