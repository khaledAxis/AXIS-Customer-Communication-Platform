# ADR-0038 — ChatGPT copy/paste translation

- Status: Accepted
- Date: 2026-09-06
- Extends: ADR-0037

The user has ChatGPT access but no API credits and requested using regular ChatGPT.
ChatGPT subscriptions and API billing are separate. Add a staff-operated copy/paste
workflow without using ChatGPT sessions as API credentials or automating its browser.
No new dependency, migration, provider call, crawler or background task is introduced.

The default translation method is **Use ChatGPT · no API credits**. A server action
prepares article passages with the same protected identifiers, numbers and structure
as the API translator. Staff copy the prepared prompt, open ChatGPT themselves, send
it there, and paste the complete reply back into AXIS. API translation remains a
separate selectable option. Normal ChatGPT account limits still apply.

Preparation is read-only. A purpose-separated HMAC receipt binds the current actor,
article, source fingerprint and a 24-hour expiry. The receipt stays in AXIS and is not
part of the prompt. Only article passages and an opaque source reference are exported;
no staff identity, CRM data, internal notes, API key or signing secret is included.
Shared replicas use the existing shared AUTH_SECRET to verify the receipt.

Import authenticates the staff member, verifies the receipt, locks and rechecks the
source, validates the bounded response and runs the existing protected-content checks.
Plain JSON and one surrounding JSON code fence are accepted, up to 200,000 characters.
Source mismatch, expired/tampered receipt, incomplete output and altered protected data
produce no article. No text is blindly emitted as HTML. Invalid paste is not a persisted
translation attempt; successful imports create provenance and audit records atomically.

Concurrent/repeated imports reuse the current completed translation without overwriting
staff edits. The result is always a separate HE/PENDING_REVIEW ContentItem. Its
ContentTranslation model field is CHATGPT_MANUAL_UNVERIFIED: neither the origin of a
pasted reply nor its actual model is verifiable. Audit metadata records MANUAL_IMPORT
and modelVerified:false. Manual imports do not consume the API request budget.

Review, editing, source comparison, canonical RTL rendering and campaign approval stay
unchanged. Machine-written or manually pasted translation is never evidence of linguistic
accuracy, content approval, recipient authorization or delivery.

Reference: [OpenAI billing separation](https://help.openai.com/en/articles/9039756).

## Source coverage clarification

A feed item can contain only a title and truncated excerpt. Its external URL does not
make the full article part of the translation. Both translation methods show missing
body text, a readable preview of saved passages, a body word count and an advisory
warning for text ending in an ellipsis. Word count or the presence of a body never
proves completeness. Staff can follow **Add full article text** to the existing editor,
paste/import and save the full text, then prepare again. Excerpt-only translation remains
supported through explicitly named actions.

The preparation response includes the overview from the same saved source as its prompt.
The source fingerprint keys the panel so a saved source change clears previous local
preparation state. Existing server fingerprint checks still refuse old responses.
Prompts state their scope and ask for translation of supplied passages only, with no
website retrieval. This clarification introduces no crawler, migration or provider call.
