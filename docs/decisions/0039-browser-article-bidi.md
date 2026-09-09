# ADR-0039 — Browser article bidirectional isolation

- Status: Accepted
- Date: 2026-09-06
- Extends: ADR-0012, ADR-0036 and ADR-0038

Mixed Hebrew/Latin article text needs semantic browser isolation without changing the
translation or inserting directional controls into author input. Native textareas cannot
contain inline HTML: they keep plain text and RTL direction while live title, summary
and body previews render `<bdi dir="ltr">`.

A pure `inlineDirectionFragments` helper is shared by React `BidiText` and the browser
profile of the existing restricted-markup renderer. It groups Latin words with spaces,
supports Unicode Latin letters, models, acronyms, units, email addresses and URLs, and
leaves surrounding sentence punctuation outside. Internal URL query punctuation and
balanced parentheses remain inside. Joining fragments reproduces the exact input.
Escaping follows segmentation; link/image attributes never receive inline tags.

The parser and block structure remain shared. Browser paragraphs, headings, quotes,
lists, links and normalized imported captions receive bdi isolation. Image-description
previews/captions use the React helper. Known Hebrew/Arabic containers stay RTL even
when starting with a Latin model. Library/inbox/composer labels and source comparisons
also use the helper. Browser article bodies are rendered from source, not stored HTML.

The default email profile retains its existing span helper, canonical preview/sender
path and frozen documents. This is a display profile, not another email template or
stored-HTML migration. No provider, translation JSON, persistence or dependency changes.

Tests cover requested names, punctuation, markup contexts, URL attributes, escaped
hostile text and source/translation immutability. Browser checks verify character positions,
computed direction, plain-value persistence and desktop/phone screenshots with synthetic data.

Reference: [MDN bdi element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/bdi).
