"use client";

import { useRef, useState } from "react";

import { normalizeArticleSource } from "../domain/content/articleFormat";
import { ArticleBodyPreview } from "./ArticleBodyPreview";
import { BidiText } from "./BidiText";

/**
 * Small formatting editor.
 *
 * Deliberately not a heavyweight WYSIWYG dependency (ADR-0012). The toolbar writes
 * a restricted markup that the server renders with the SAME pure function used
 * here for the live preview — so what the user sees is what the email contains, and
 * no client-supplied HTML is ever stored.
 */

interface ToolbarAction {
  label: string;
  title: string;
  /** Wraps the current selection, or inserts at the caret when nothing is selected. */
  apply: (selected: string) => { text: string; caretOffset?: number };
  /** Line-level actions operate on whole lines instead of the raw selection. */
  linePrefix?: string;
}

const ACTIONS: ToolbarAction[] = [
  {
    label: "H",
    title: "Section heading",
    apply: (s) => ({ text: `## ${s || "Section heading"}` }),
    linePrefix: "## ",
  },
  {
    label: "h",
    title: "Smaller heading",
    apply: (s) => ({ text: `### ${s || "Smaller heading"}` }),
    linePrefix: "### ",
  },
  { label: "B", title: "Bold", apply: (s) => ({ text: `**${s || "bold text"}**` }) },
  { label: "I", title: "Italic", apply: (s) => ({ text: `*${s || "italic text"}*` }) },
  {
    label: "🔗",
    title: "Link",
    apply: (s) => ({ text: `[${s || "link text"}](https://)` }),
  },
  { label: "• List", title: "Bullet list", apply: (s) => ({ text: `- ${s || "list item"}` }), linePrefix: "- " },
  { label: "Picture", title: "Inline picture", apply: (s) => ({ text: `\n\n![${s || "Picture description"}](https://)\n\n` }) },
  { label: "Quote", title: "Quotation", apply: (s) => ({ text: `\n\n> ${s || "Quotation"}\n\n` }) },
  {
    label: "1. List",
    title: "Numbered list",
    apply: (s) => ({ text: `1. ${s || "list item"}` }),
    linePrefix: "1. ",
  },
];

export function RichTextEditor({
  name,
  defaultValue = "",
  language,
  baseUrl,
  title,
  summary,
}: {
  name: string;
  defaultValue?: string;
  language: string;
  baseUrl?: string;
  title?: string;
  summary?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [showPreview, setShowPreview] = useState(true);
  const [pasteNotice, setPasteNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dir = language === "HE" || language === "AR" ? "rtl" : "ltr";
  const normalized = normalizeArticleSource(value, baseUrl);

  const applyAction = (action: ToolbarAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const { text } = action.apply(selected);

    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setValue(next);

    // Restore focus so the user can keep typing straight away.
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-sky-50 px-3.5 py-3 text-xs leading-relaxed text-slate-700">
        Paste from a webpage or document, write normally, or mix text with HTML and Markdown.
        Headings, lists, links, quotes and pictures adapt to the newsletter. Table rows become readable text.
        {pasteNotice && <p role="status" className="mt-1 font-semibold text-sky-800">{pasteNotice}</p>}
        {normalized.format === "HTML" && <p className="mt-1 font-semibold text-sky-800">Formatted content detected. The preview shows how it will be saved.</p>}
        {normalized.truncated && <p role="alert" className="mt-1 font-semibold text-amber-800">This content is too large or complex to adapt in full. Paste a smaller section before saving.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.html,.htm" className="hidden" aria-label="Import article file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!/\.(?:txt|md|markdown|html|htm)$/i.test(file.name) || file.size > 200_000) {
              setPasteNotice("Choose a text, Markdown or HTML file smaller than 200 KB."); return;
            }
            try {
              const imported = await file.text();
              // Keep the input until save so adding its source URL can resolve relative pictures.
              setValue(current => current.trim() ? `${current}\n\n${imported}` : imported);
              setPasteNotice("File added. Review the preview, then save the article.");
            } catch { setPasteNotice("The file could not be read. Try pasting its text instead."); }
          }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-800">Import text file</button>
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.title}
            aria-label={action.title}
            onClick={() => applyAction(action)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-sky-50 hover:text-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            {action.label}
          </button>
        ))}
        <div className="ms-auto">
          <button
            type="button"
            onClick={() => setShowPreview((current) => !current)}
            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white"
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
      </div>

      <div className={showPreview ? "grid gap-px bg-slate-200 md:grid-cols-2" : ""}>
        <textarea
          ref={textareaRef}
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={(event) => {
            const html = event.clipboardData.getData("text/html");
            if (!html) return;
            event.preventDefault();
            const pasted = normalizeArticleSource(html, baseUrl);
            if (pasted.truncated) {
              setPasteNotice("That selection is too large or complex. Copy a smaller section and paste it again."); return;
            }
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            setValue(`${value.slice(0, start)}${pasted.source}${value.slice(end)}`);
            setPasteNotice("Formatting adapted. Review the text and pictures before saving.");
            requestAnimationFrame(() => textarea.setSelectionRange(start + pasted.source.length, start + pasted.source.length));
          }}
          rows={16}
          dir={dir}
          aria-label="Article text"
          placeholder="Write or paste your article here. Different formats can be combined."
          className="block w-full resize-y border-0 bg-white px-3.5 py-3 font-mono text-sm leading-relaxed text-slate-900 focus:outline-none focus:ring-0"
        />

        {showPreview ? (
          <div className="bg-white px-3.5 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              How it will look
            </div>
            {title && <h2 dir={dir} className="mb-3 break-words text-start text-xl font-bold text-slate-900"><BidiText text={title} dir={dir} /></h2>}
            {summary && <p dir={dir} className="mb-4 break-words text-start text-sm leading-relaxed text-slate-600"><BidiText text={summary} dir={dir} /></p>}
            {value.trim() === "" ? (
              <p className="text-sm text-slate-400">Nothing to preview yet.</p>
            ) : (
              <ArticleBodyPreview source={normalized.source} dir={dir} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
