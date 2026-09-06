# ADR-0037 — Reviewed Hebrew article translation

- Status: Accepted
- Date: 2026-09-06
- Amends: ADR-0026's deferred AI boundary; ADR-0036 article authoring.

The user requested smart Hebrew translation and selected OpenAI. Translation is an
explicit staff action on an external article. It creates a separate HE ContentItem in
PENDING_REVIEW; it never overwrites the source, approves content, attaches a campaign,
chooses recipients or sends email. Existing review, campaign approval and send gates apply.

Use a server-only TranslationProvider port and a fixed OpenAI Responses API adapter,
with structured output, no tools, no automatic retries and store:false. Default model
is the pinned gpt-5.4-mini-2026-03-17; an operator may configure another compatible model.
The provider is disabled without explicit environment configuration and under tests.
No new SDK is required for this bounded HTTP interface. Only selected article text is
sent, never CRM records, internal notes, staff identities, secrets or customer lists.

Conversion preserves paragraph/list structure, picture references, links, product
identifiers and numbers through validated placeholders. A surveying/mapping glossary
guides natural Hebrew. Hebrew uses real RTL semantics with Latin phrase isolation in
the canonical body renderer. Machine output remains untrusted and must pass validation.

ContentTranslation records actor, source fingerprint, model, attempt state and the
generated article. A short PostgreSQL advisory transaction serializes admission:
reuse a completed result for the same source; refuse duplicate active work; limit
concurrent and daily requests. Never hold a database transaction over a provider call.
Bounded batches share a timeout; partial, refused, malformed, stale or interrupted
results create no article. A failed attempt may be retried only by another staff action.
Creating the result, recording completion and auditing commit atomically. A source
edit while work is running invalidates its result. Source records with translation
history cannot be deleted; deleting an unused translated draft preserves attempt history.

The original article's review page offers Create Hebrew draft and a link to existing
results. The translated editor includes original text for comparison and remains
editable/reviewable through existing workflows. AI translation is not evidence of
linguistic accuracy. Live quality needs a human sample review with a configured key.

References: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
