# ADR-0016: Cloudinary as the newsletter image store

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Relates to:** realises the hosted half of the `MediaStore` port (ADR-0012); removes the practical blocker created by ADR-0015's image-omission rule.

## Context

ADR-0015 established that images which cannot resolve outside this machine are **omitted**
from the email rather than delivered as broken boxes. Correct, but it left every real test
email pictureless: development uploads live in `var/media/` and are served from
`localhost`.

The fix needed a public host. Cloudinary was chosen and configured, so this ADR records
how it is wired in and — more importantly — what it is *not* allowed to change.

## Decision

### 1. A second MediaStore implementation, nothing else

`CloudinaryMediaStore` is the only file aware of the Cloudinary SDK. Selection is by
`MEDIA_PROVIDER` in a single factory (`server/media/index.ts`). The content domain,
services, upload route and UI are unchanged and remain storage-agnostic — the same
property that made swapping the *email* transport a one-file change (ADR-0014).

### 2. `CLOUDINARY_URL` only, treated as a secret

Configuration comes from the single `CLOUDINARY_URL`
(`cloudinary://<api_key>:<api_secret>@<cloud_name>`); the three separate variables are
not supported, since one value is simpler and there is no benefit to two ways of saying
it. It embeds credentials, so it is **never** logged, echoed in an error, returned from a
readiness check, persisted, or exposed to the browser. Only the *cloud name* is ever
extracted, and only because it is public — it appears in every delivery URL.

Uploads are server-side and authenticated via `upload_stream`. No unsigned upload preset
and no browser-side signature: the client never holds anything that could upload on the
account's behalf.

### 3. Local validation is never delegated to the provider

Magic-byte sniffing, the type allow-list, SVG rejection, the 5 MB ceiling and filename
sanitisation all run **before** any provider call, exactly as before. Cloudinary would
happily accept files this application must refuse; the provider is a store, not a
gatekeeper. Tests assert that a rejected file produces **zero** upload attempts.

### 4. Generated public IDs under one folder

Assets go to `axis-newsletter/content/` with a public ID of a short readable slug plus 16
random hex characters. The client filename is never authoritative, so collisions and
traversal are impossible; the slug exists only to make the Cloudinary console browsable.
Tags are `axis-newsletter` and `content`. No customer data and no secrets in metadata.

### 5. `secure_url`, or nothing

Only `secure_url` is persisted into `ContentItem.imageUrl`. A response without a usable
HTTPS URL is an **error**, not a fallback to the insecure `url` field. A failed upload
returns no URL at all, so the caller keeps the article's existing image rather than
saving a broken one.

### 6. Email sizing at delivery, not at upload

`emailDeliveryUrl()` (pure, in `domain/`) inserts `c_limit,w_1280,q_auto` after
`/image/upload/`. 1280px covers a 2× retina display of the 640px container; `c_limit`
only scales **down** and preserves aspect ratio, so nothing is cropped or stretched.

`f_auto` is deliberately **not** used — it can negotiate AVIF, which several email clients
cannot display. WebP is converted with `f_jpg` because Outlook on Windows does not render
WebP; every other format is delivered as uploaded so PNG transparency survives. The
function is idempotent, so re-rendering cannot stack transformations. The stored asset is
never modified — only the delivery URL is shaped.

### 7. Replacement creates a new asset; nothing is destroyed

`remove()` on the Cloudinary store is an intentional **no-op**. A sent email still
references its delivery URL, so destroying the asset would break historical mail.
Replacing an image uploads a *new* asset and repoints the `ContentItem`. Reclaiming
genuinely unreferenced assets is a later maintenance task, deliberately deferred.

### 8. Preview/send parity and approval invalidation are preserved

Both paths render through the same function with the same delivery URL, so the approval
hash still binds to the exact HTML. Replacing an image changes the URL, changes the HTML,
changes the hash, and therefore **invalidates any existing approval** — verified by test.

### 9. Legacy local images are surfaced, not migrated

Existing `/api/media/...` URLs are left alone. The editor labels them *"Local image —
replace to make it available in email"* and the normal Replace action uploads to
Cloudinary. Auto-migration was rejected: it would rewrite content the user did not ask to
change, and the renderer already guarantees such an image can never reach a recipient.

## Alternatives Considered

- **Three separate `CLOUDINARY_*` variables.** More to get wrong for no gain; the single
  URL is what the Cloudinary console hands you.
- **Browser-side (unsigned/signed) upload direct to Cloudinary.** Faster, but it puts an
  upload capability in the client and bypasses the server-side magic-byte validation that
  is the whole point of the image policy.
- **`f_auto` for best compression.** Rejected: AVIF negotiation is a real risk in email.
- **Destroying the old asset on replace.** Rejected outright — it breaks already-sent mail.
- **Auto-migrating existing local images.** Rejected as a silent rewrite of user content.

## Consequences

- Newsletter images now reach real inboxes, at a sensible size, over HTTPS.
- The provider swap touched one new adapter and one factory line; no domain, service or
  UI logic changed — the port has now proven itself twice.
- Cost: Cloudinary assets accumulate, since replacement never deletes. Acceptable while
  volume is tiny; a cleanup task that cross-checks against `ContentItem` and campaign
  snapshots is the eventual answer.
- WebP uploads are delivered to email as JPEG, so a transparent WebP would gain a
  background. PNG remains the right choice for logos.
- `MEDIA_PROVIDER=local` remains fully supported and is still the default in
  `.env.example`; it is honest about its limitation rather than pretending to work.
