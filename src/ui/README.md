# `src/ui` — Reusable presentational components

Small, typed, **RTL-aware** presentational components shared across routes. Use Tailwind **logical**
utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start/end`) so components mirror correctly under
`dir="rtl"` for Hebrew and Arabic. Keep components presentational; data fetching and business logic
belong in Server Components/services, not here. Server Components by default; add `"use client"` only
where interactivity requires it.

The workspace uses a navy navigation rail, blue primary actions, neutral surfaces, and
shared typography, controls, badges and cards from `primitives.tsx` and `app/globals.css`.
`Icon.tsx` owns the small inline SVG vocabulary; no icon or component dependency is needed.
The system font stack includes Hebrew and Arabic fallbacks and the canvas stays light
regardless of OS theme so forms and status indicators maintain consistent contrast.

`AppShell` groups pages by workflow and marks only the longest matching route active.
Its mobile navigation is a disclosure; Escape closes it and returns focus to the trigger.
The native page-search dialog supports Ctrl/Cmd+K, typed page filtering, keyboard
navigation, Escape, and focus restoration. It searches permitted navigation destinations,
not customer records. Server authorization remains the boundary for every destination.

The dashboard reads existing services for actual counts and recent newsletters. Newsletter
search and status filters are encoded in the URL, survive refresh, and can be cleared.
Empty collections and empty search results provide distinct next steps.

Email previews use the canonical renderer without modification. The computer canvas is
at least 680px and the phone canvas is 390px. Small screens scroll within the preview
canvas, preserving the chosen email viewport without widening the application page.
The preview and controls stack until enough space exists for a full desktop email.

Browser coverage in `e2e/specs/03-responsive.spec.ts` checks navigation, page search,
focus, filters, overflow, and captures desktop/mobile screens for visual review.

`RichTextEditor` accepts ordinary text, restricted Markdown, formatted clipboard HTML,
and text/Markdown/HTML files in one body (ADR-0036). The live preview shares the pure
converter and email-safe body renderer with server saves. Imported HTML is shown as
editable markup after saving. Article source URLs resolve relative pictures and links;
binary document pictures still use the existing uploader. Large/complex input is reported
instead of silently saving a partial article. Newsletter preview remains canonical.

## Hebrew translation review (ADR-0037)

`ArticleTranslationPanel` requests a separate Hebrew draft on an external article.
It shows setup, pending, failure and existing-result states. The translated editor
shows original text for comparison, a source-change warning, and the existing Hebrew
form. Approval remains a deliberate action. The editor and canonical email renderer
use real RTL direction with Latin phrase isolation.

`ChatgptArticleTranslation` is the default no-API copy/paste path (ADR-0038). It prepares
the source, copies a prompt with manual-select fallback, links to ChatGPT without sending
article data in the URL, and imports a complete reply. API translation has its own explicit
method button. Both routes end at the same editable, unapproved Hebrew draft.
`TranslationSourceDetails` shows what text is available, flags a missing body or apparent
truncation and links to the article-text editor. The translation panel is keyed by the
saved source fingerprint so edits clear obsolete copy/paste preparation state.

`BidiText` and `ArticleBodyPreview` share pure Latin-fragment segmentation (ADR-0039).
Browser article views use `bdi dir="ltr"` within RTL containers; input values stay plain
text. The body preview reuses the restricted parser with a browser display profile.
Email rendering retains the existing canonical path. Caption/description previews use
the same helper as titles, summaries and source text.
