# Use regular ChatGPT for Hebrew articles

This option uses your normal ChatGPT account and **does not use API credits**.
Your usual ChatGPT access and usage limits apply. Translation needs a copy/paste step;
the AXIS app does not sign into ChatGPT or send a message there for you.

1. Open the external article in **Review inbox** or **Content → Edit article**.
2. Check **Text included in this translation**. If **Article text missing** appears,
   choose **Add full article text**, paste/import the complete text in the editor and
   **Save changes**. Then choose **Use ChatGPT · no API credits → Prepare for ChatGPT**.
   If you want only the saved excerpt, choose **Prepare title and excerpt only** instead.
3. Select **Copy prompt**, then **Open ChatGPT**. Paste the prompt into a conversation
   and send it. Wait for the complete reply and copy it all.
4. Return to AXIS, paste the reply into **Paste ChatGPT’s reply**, and choose
   **Save Hebrew draft**.
5. Compare the original and Hebrew text, edit and save your changes, then approve it
   when it is ready for a Hebrew newsletter.

The prepared prompt asks ChatGPT to preserve the formatting and protected names,
figures and links. Copy its reply as-is; edit the readable Hebrew after importing.
AXIS restores the protected text, checks completeness and saves a separate draft.
The original article stays intact. This action does not send email or approve content.

A source website link is not the article text. Feed collection can supply just a headline
and a short introduction ending in an ellipsis. Adding that link to a ChatGPT conversation
does not extend AXIS's prepared passages. Paste only the prepared prompt into ChatGPT;
paste only its complete translation response back into AXIS, not the conversation history.
To translate more text, first save it in the AXIS article and prepare again. Saving changed
source text clears the previous preparation. An ellipsis warning is advisory, and a saved
body or word count does not prove that all publisher paragraphs are present.

If copying is blocked by the browser, expand **View or select the prepared prompt**
and copy its text manually. A preparation lasts 24 hours for the same AXIS account.
If the source changes, use **Prepare a fresh prompt** and translate the updated version.
If you closed the page but the source is unchanged, prepare it again before importing.
An existing Hebrew version is reused so repeated imports do not overwrite staff edits.

The returned format is checked, but AXIS cannot verify which model produced a pasted
reply or prove its meaning is correct. A person must review the Hebrew. No connection
to the ChatGPT website is exercised by the automated tests.

**Automatic translation · API** remains available separately. Its configured OpenAI
account currently has exhausted API credits. That does not affect this copy/paste path.
ChatGPT subscriptions and API use are billed separately. See
[OpenAI's explanation](https://help.openai.com/en/articles/9039756).

## Implementation and checks

No schema migration or new dependency. Preparation reads the article but makes no database
write or external provider call. The server verifies a signed preparation receipt, current source fingerprint,
complete response and protected content before atomically creating the Hebrew draft,
translation provenance and audit record. Human imports are recorded as unverified model
output and excluded from API quotas. See [ADR-0038](decisions/0038-chatgpt-copy-paste-translation.md).

New files:

- `src/domain/content/chatgptTranslation.ts`
- `src/domain/content/chatgptTranslation.test.ts`
- `src/server/services/chatgptTranslationToken.ts`
- `src/server/services/chatgptTranslationToken.test.ts`
- `src/ui/ChatgptArticleTranslation.tsx`
- `e2e/specs/10-chatgpt-translation.spec.ts`
- `docs/decisions/0038-chatgpt-copy-paste-translation.md`
- `docs/chatgpt-translation.md`

Modified files:

- `src/server/services/articleTranslationService.ts`
- `src/app/content/translationActions.ts`
- `src/ui/ArticleTranslationPanel.tsx`
- `src/app/content/inbox/[id]/page.tsx`
- `tests/integration/articleTranslation.int.test.ts`
- `e2e/specs/09-hebrew-translation.spec.ts`
- `AGENTS.md`
- `README.md`
- `docs/architecture.md`
- `docs/requirements.md`
- `docs/decisions/README.md`
- `docs/hebrew-translation.md`
- `docs/testing.md`
- `src/ui/README.md`

Local check output is under `var/chatgpt-*`; all test data is synthetic and only uses
the guarded test database. Other preexisting checkout changes belong to earlier tasks.

Validation on 2026-09-06:

- Build: PASS — production build and standalone startup for the browser checks.
- Typecheck: PASS — `npm run typecheck`.
- Lint: PASS — `npm run lint`, no warnings.
- Tests: PASS — 1,545 Vitest tests across 91 files and all nine browser checks in
  authenticated rendering, Hebrew translation and ChatGPT copy/paste translation.
- Desktop and phone screenshots reviewed; no horizontal overflow in the phone check.
- Local app restarted; login and readiness both return HTTP 200.
- Actual ChatGPT translation quality: NOT RUN. Browser checks import an invented
  response; no live ChatGPT or OpenAI API call was made for this change.

## Follow-up: missing article text

The source coverage clarification was validated separately on 2026-09-06: Build,
Typecheck and Lint PASS; all 37 focused domain/service tests and nine browser checks
PASS. Desktop and phone screenshots were reviewed. Tests use synthetic passages and
only the test database; live translation quality was not retested.

Exact files in this follow-up:

- Added `src/ui/TranslationSourceDetails.tsx`.
- Updated `src/ui/ArticleTranslationPanel.tsx`, `src/ui/ChatgptArticleTranslation.tsx`,
  `src/ui/ContentForm.tsx` and `src/ui/README.md`.
- Updated `src/domain/content/hebrewTranslation.ts`,
  `src/domain/content/hebrewTranslation.test.ts`, `src/domain/content/chatgptTranslation.ts`
  and `src/domain/content/chatgptTranslation.test.ts`.
- Updated `src/server/services/articleTranslationService.ts`,
  `src/app/content/translationActions.ts`, `src/app/content/[id]/edit/page.tsx`
  and `src/app/content/inbox/[id]/page.tsx`.
- Updated `tests/integration/articleTranslation.int.test.ts`,
  `e2e/specs/09-hebrew-translation.spec.ts` and `e2e/specs/10-chatgpt-translation.spec.ts`.
- Updated `AGENTS.md`, `docs/architecture.md`, `docs/requirements.md`, `docs/testing.md`,
  `docs/decisions/0038-chatgpt-copy-paste-translation.md` and this guide.
