# Mixed-format articles — implementation and usage

Implemented 2026-09-06 under ADR-0036.

## What changed

An article can combine ordinary text, restricted Markdown, formatted clipboard HTML,
raw HTML fragments and entity-encoded HTML. The application converts these inputs to
its editable article format and renders them in the AXIS newsletter layout. Headings,
emphasis, lists, links, quotations and multiple inline pictures retain their order.
Table rows become readable text; publisher layouts and styling are removed.

The external-feed defect had two causes: markup was stripped before XML entities were
decoded, and the ingestion service discarded parsed pictures. Excerpts are now decoded
and cleaned before their length limit, and public picture references are retained.
Existing imported summaries receive the same display correction without a database
rewrite. Source metadata stays separate from AXIS editorial copy; the newsletter uses
the editorial headline, summary and CTA where supplied.

## Using it

1. Open Content → Write an article, or edit an existing article.
2. Set the language, title and short summary. Add the original article URL when its
   pictures or links use relative addresses.
3. Paste into Article text. Formatted clipboard content is converted immediately;
   ordinary text, Markdown and raw HTML can be mixed in the same body.
4. Use Import text file to append `.txt`, `.md`, `.markdown`, `.html` or `.htm` content.
5. Review the adjacent preview, save, then reload to see the stored editable markup.
6. Approve the article, add it to a newsletter and inspect Computer and Phone previews.

Feed collection still creates review-required excerpts. It does not download full
web articles. The review inbox can import a referenced picture explicitly through the
existing image store; that operation now shares public-DNS and streaming-size checks
with the feed downloader and still validates image bytes before storage.

## Boundaries

- Imported files: 200 KB. Raw server input: 200,000 characters. Saved body: 50,000
  characters. Excessive nesting is refused before an article can be saved partially.
- PDF, DOCX and RTF binaries are not imported. Copy their text/formatted content into
  the editor; embedded binary pictures use the existing image uploader.
- Video players, scripts, forms and publisher CSS are not part of the email format.
- Referenced external pictures depend on the publisher keeping them available.
- Text already lost through an earlier excerpt truncation cannot be reconstructed.
- Existing dispatch documents and frozen content snapshots take precedence. Changed
  rendered messages invalidate old message-bound approvals. No sending gate is relaxed.
- No schema migration, operational data rewrite, live feed collection or email send
  was performed for this change.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:workflows` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 1,493 tests in 86 files |
| Production build + standalone preparation | PASS — executed by Playwright webServer |
| Authenticated browser specs 01, 07, 08, Chromium | PASS — 11 tests |
| Restarted local app, `/api/health/ready` | PASS — HTTP 200, status ok |

The browser run exercises formatted paste plus HTML-file import in one article,
save/reload, approval, newsletter composition and computer/phone preview. Its synthetic
picture is intercepted locally. The resulting editor screenshot was visually inspected.
Tests use the guarded synthetic database; operational data is not a test fixture.
The browser tool exposed no open tab for this task, so the user's current newsletter
was not inspected through that tool. Authenticated workflow evidence comes from the
synthetic browser run, not an assumption based on the anonymous health endpoint.

The first full-suite run exposed an existing global event-count assertion in the QA
suite. That assertion now scopes to its actor and unique provider receipt, and source
checks explicitly forbid campaign-ledger access. The full rerun passed. Browser action
checks wait for persisted UI updates before navigating, avoiding aborted action streams.
The successful production browser run still reports a non-failing Node Gzip listener
warning; its cause is not established by these checks. No application page errors or
failed assertions were recorded in the format workflow.

Commands: `npm install parse5@8.0.1 --save-exact`; the checks above; and
`npm run e2e -- e2e/specs/01-authenticated-render.spec.ts e2e/specs/07-workflows.spec.ts e2e/specs/08-article-formats.spec.ts --project=chromium`.

## Exact file inventory for this change

Earlier unrelated workspace changes were preserved. This feature touched:

| Area | Files |
| --- | --- |
| Dependency | `package.json`, `package-lock.json` |
| Input conversion | `src/domain/content/articleFormat.ts` (new), `src/domain/content/articleFormat.test.ts` (new), `src/domain/content/feedParser.ts`, `src/domain/content/feedParser.test.ts`, `src/domain/content/richText.ts` |
| Canonical email | `src/domain/email/newsletterTemplate.ts`, `src/server/services/newsletterService.ts` |
| Content workflows | `src/server/services/contentService.ts`, `src/server/services/contentIngestionService.ts`, `src/server/services/contentReviewService.ts` |
| Explicit image download | `src/server/integrations/content/feedFetcher.ts`, `src/server/integrations/content/feedFetcher.test.ts` (new) |
| Editor | `src/ui/ContentForm.tsx`, `src/ui/RichTextEditor.tsx` |
| Integration/browser coverage | `tests/integration/contentWorkflow.int.test.ts`, `tests/integration/contentAutomation.int.test.ts`, `tests/integration/qaEmail.int.test.ts`, `e2e/specs/08-article-formats.spec.ts` (new) |
| Documentation | `AGENTS.md`, `src/domain/README.md`, `src/ui/README.md`, `docs/architecture.md`, `docs/requirements.md`, `docs/testing.md`, `docs/decisions/README.md`, `docs/decisions/0036-mixed-format-article-adaptation.md` (new), this report (new) |
