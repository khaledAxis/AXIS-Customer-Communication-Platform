# Hebrew/Latin article rendering

Hebrew article containers stay RTL. Browser-rendered Latin phrases, product models,
acronyms, units, URLs and email addresses are isolated with `bdi dir="ltr"`. Names such
as NavVis CLX and NavVis VLX stay together. Surrounding commas, full stops and prose
brackets remain outside; URL query syntax and balanced URL parentheses remain inside.

The same fragment helper serves the editor's title/summary/body previews, review article
body, captions, source comparisons, and library/inbox/composer labels. Imported caption
text remains part of the existing normalized markup. Long URLs wrap within the preview;
lists retain visible markers on the RTL edge.

This is a rendering change. Stored title, summary, body, image description and translation
JSON receive no bdi markup or invisible directional characters. Native text fields stay
plain text, with their visual result shown in the live preview. The canonical email
renderer and its existing Outlook-compatible span behavior remain unchanged. See
[ADR-0039](decisions/0039-browser-article-bidi.md) and the
[bdi element reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/bdi).

## Files in this change

Added:

- `src/domain/content/inlineDirection.ts`
- `src/domain/content/inlineDirection.test.ts`
- `src/ui/BidiText.tsx`
- `src/ui/ArticleBodyPreview.tsx`
- `e2e/specs/11-article-bidi.spec.ts`
- `docs/decisions/0039-browser-article-bidi.md`
- `docs/article-bidi.md`

Modified:

- `src/domain/content/richText.ts`
- `src/ui/RichTextEditor.tsx`
- `src/ui/ContentForm.tsx`
- `src/ui/ImageUploader.tsx`
- `src/ui/TranslationSourceDetails.tsx`
- `src/ui/InboxList.tsx`
- `src/app/content/[id]/edit/page.tsx`
- `src/app/content/inbox/[id]/page.tsx`
- `src/app/content/inbox/page.tsx`
- `src/app/content/page.tsx`
- `src/app/newsletters/[id]/page.tsx`
- `AGENTS.md`
- `docs/architecture.md`
- `docs/requirements.md`
- `docs/decisions/README.md`
- `docs/testing.md`
- `src/ui/README.md`

Other checkout changes predate this task. No migration or new dependency.

## Verification

Validation on 2026-09-06: Typecheck PASS, Lint PASS, 143 focused tests PASS across five
files. Eleven browser checks passed for authenticated pages, mixed-format authoring,
Hebrew review, ChatGPT import and BiDi rendering. The focused BiDi flow is rerun with
the final browser profile through a production build: Build PASS and final BiDi browser
check PASS. Desktop/phone article rendering and captions were inspected visually; local
preview overflow and RTL character geometry checks passed. The app was restarted and
readiness/login returned HTTP 200. Screenshots and logs are local
under `var/bidi-*`. All browser data is synthetic and uses the guarded test database;
no live translation, CRM, email or media provider is contacted.
