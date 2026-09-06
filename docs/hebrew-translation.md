# Reviewed Hebrew article translation

**Regular ChatGPT is now available without API credits.** The default option prepares
a prompt to copy into ChatGPT, then imports its reply as a Hebrew draft.
Follow the [ChatGPT copy/paste guide](chatgpt-translation.md). The API option below is
separate and still requires API billing.

Open an external article in **Review inbox** or **Content → Edit article**, then choose
**Automatic translation · API → Create Hebrew draft**. The app translates the saved title, excerpt and available body.
It preserves the original and creates a separate Hebrew article marked **Needs review**.
This works with the mixed-format importer: normalize/save pasted or imported content first.
A feed containing only an excerpt produces only an excerpt translation; no webpage is fetched.

The Hebrew editor uses right-to-left direction and shows the original for comparison.
Review technical meaning, product names, measurements and links, edit the draft, save,
then choose **Approve**. Only then is it offered for a Hebrew newsletter. Preview and email
use the same canonical renderer. English product phrases retain left-to-right direction
inside Hebrew text, including measurements such as `40 m` and `-5 mm`. Preparing a translation
creates no campaign, approval, recipient or email.

## Enable OpenAI on the application server

The local application now has the user-provided key in ignored `.env.local` and translation
is enabled. A live check on 2026-09-06 reached OpenAI but was refused with HTTP 429,
`credit_balance_exhausted`. **OpenAI API billing needs credits before translation can work.**
No translated article, customer data change or email was created by the live check.

For another installation, an administrator supplies a project API key through the server's
external secrets or local `.env.local`, sets these variables and restarts the application:

```dotenv
TRANSLATION_ENABLED="true"
OPENAI_API_KEY="<your project API key>"
TRANSLATION_OPENAI_MODEL="gpt-5.4-mini-2026-03-17"
```

Keep the key out of source control and browser settings. Configure API billing and project
spending controls in the OpenAI project. The optional model override must support the
Responses API, strict structured outputs and `reasoning.effort=none`. Requests use the fixed
OpenAI endpoint, `store:false`, no tools and no automatic retries. `store:false` concerns
response storage; it is not a claim of zero retention under every provider/account policy.
Credit exhaustion, spending limits, usage limits, temporary throttling, invalid credentials
and model-access failures have distinct safe messages. Raw provider error text is never
returned to a browser or written to audit history. The UI explains that article text is
sent to OpenAI. No CRM records, staff identities,
internal notes or customer lists are submitted. No new SDK dependency is needed.

The host must allow outbound HTTPS to `api.openai.com` and a request lasting at least
120 seconds. Hosted releases apply migrations separately before starting the new image.
The two additive migrations for this feature are already applied to the local development
and synthetic test databases. Do not run a test reset against the development database.

## What “smart” means here

- A surveying and mapping glossary guides Hebrew wording: point clouds, digital twins,
  accuracy, reality capture, georeferencing and mobile mapping.
- Protected markers preserve recognized brands, acronyms, product codes, numbers, units,
  link destinations, images and markup. The server restores and validates them; publisher
  HTML and CSS never pass through into a newsletter.
- Headings, paragraphs, lists, emphasis, pictures and links stay editable. Table input uses
  the mixed-format converter's readable rows. Images are referenced, never downloaded.
- A finished translation of the same source is reused, including subsequent human edits.
  A changed source can produce a new draft. An edit during translation discards the result.
  Comparison shows the current original and warns if it changed after generation; it is
  not a historical source snapshot. Existing frozen campaign snapshots remain authoritative.
- Partial, refused, timed-out or invalid output creates no draft. An explicit new request
  is needed to retry. Attempts and outcomes are audited without storing provider responses.

These checks protect structure and selected facts. They do not establish semantic accuracy;
a Hebrew-speaking reviewer still checks the translation before approval. Image alternative
text is preserved from the source rather than translated.

## Bounds and operations

At most two article translations run concurrently across application replicas. Each uses
up to two bounded API batches concurrently with a shared 90-second timeout. An attempt expires
after 120 seconds and is recorded as interrupted on the next admission. Daily UTC limits are
100 requests for the application and 20 per staff member, with five per minute per person.
Failed attempts count toward limits. A cache hit does not make an API call. Database admission
is serialized briefly; no database transaction stays open while OpenAI works.

Source limits: 500-character title, 2,000-character excerpt, 50,000-character normalized body,
and 300 passages. Output must fit the existing editor: 200-character title, 500-character
excerpt and 50,000-character body. Oversized results are refused, not silently truncated.
If an excerpt is long, move its full text into the article body and shorten the excerpt
before requesting translation. No translated text is inserted into an approved campaign.

Source articles with translation history cannot be deleted. Unused translated drafts can
be deleted; the attempt remains as history. Source and draft identities are separate so
feed recollection cannot overwrite the prepared Hebrew version.

## Validation and local release evidence

Build: PASS (Next.js production build and standalone browser server).
Typecheck: PASS. Lint: PASS, no warnings. Tests: PASS, 1,530 checks across 89 Vitest
files and 14 distinct browser checks across the relevant suites. Hebrew review was
also rerun after the final API error changes and after supplying the local API key;
the browser test server still correctly received no key and refused live translation.
Desktop/mobile review screens and the phone email view were visually inspected.

See `var/translation-full-tests.log`, `var/translation-lint.log`,
`var/translation-typecheck.log`, `var/translation-e2e-final.log` and
`var/translation-e2e-proof.log` for local check output; QA fixture-isolation checks are
in `var/translation-e2e-fixtures.log`. Browser tests use synthetic articles
and no OpenAI key. Real provider connectivity was checked with invented article text;
translation was refused because API credits are exhausted. Real Hebrew output quality is
NOT RUN. Safe diagnostic evidence is in `var/translation-live-check.json`; it contains no key.
Add credits in [OpenAI API billing](https://platform.openai.com/settings/organization/billing)
before retrying; no additional live checks are scheduled automatically.

The local release created and authenticated an encrypted database backup outside the
checkout, inspected its archive directory, then applied the two migrations with Prisma.
Counts and fingerprints across all 49 preexisting application tables matched before and
after migration. Backup metadata is in `var/translation-backup-result.json`; keys and archives
remain outside the repository. This verifies local migration preservation, not a hosted
disaster-recovery rehearsal.

## Files in this change

New files:

- `src/domain/content/hebrewTranslation.ts`
- `src/domain/content/hebrewTranslation.test.ts`
- `src/server/integrations/translation/translationProvider.ts`
- `src/server/integrations/translation/openaiTranslationProvider.ts`
- `src/server/integrations/translation/index.ts`
- `src/server/integrations/translation/translationProvider.test.ts`
- `src/server/integrations/translation/README.md`
- `src/server/services/articleTranslationService.ts`
- `src/app/content/translationActions.ts`
- `src/ui/ArticleTranslationPanel.tsx`
- `tests/integration/articleTranslation.int.test.ts`
- `e2e/specs/09-hebrew-translation.spec.ts`
- `prisma/migrations/20260906100000_reviewed_hebrew_translation/migration.sql`
- `prisma/migrations/20260906101000_translation_audit_actions/migration.sql`
- `docs/decisions/0037-reviewed-hebrew-article-translation.md`
- `docs/hebrew-translation.md`

Modified files:

- `.env.example`
- `AGENTS.md`
- `README.md`
- `docs/architecture.md`
- `docs/requirements.md`
- `docs/decisions/README.md`
- `docs/testing.md`
- `prisma/schema.prisma`
- `src/server/db/migration-manifest.json`
- `src/server/db/prisma.ts`
- `src/server/db/repositories/contentRepository.ts`
- `src/server/services/contentService.ts`
- `src/server/services/newsletterDraftService.ts`
- `src/domain/content/richText.ts`
- `src/domain/email/newsletterTemplate.ts`
- `src/app/content/inbox/[id]/page.tsx`
- `src/app/content/[id]/edit/page.tsx`
- `src/ui/README.md`
- `tests/integration/contentWorkflow.int.test.ts`
- `playwright.config.ts`
- `e2e/seed.mjs`
- `e2e/preflight.mjs`
- `e2e/specs/02-actions.spec.ts`
- `e2e/support.ts`

The E2E seed now labels QA rows as owned `TEST_FIXTURE` records and cleans only those
owned records, honoring the existing test-ledger boundary. It never fabricates LIVE sends.
The corresponding QA browser check verifies fixture exclusion; PASS/FAIL state changes
retain their owned-fixture service coverage and actual inbox rendering remains manual.
Ignored local evidence lives under `var/translation-*` and Playwright's output directories.
Other existing uncommitted work in this checkout belongs to earlier tasks.
Local configuration changed only in ignored `.env.local`; its secret is not part of the diff.

Decision and API references: [ADR-0037](decisions/0037-reviewed-hebrew-article-translation.md),
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[OpenAI API credit and limit errors](https://developers.openai.com/api/docs/guides/error-codes).
