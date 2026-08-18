"use client";

import { useRef, useState } from "react";

import { renderRichText } from "../domain/content/richText";

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
}: {
  name: string;
  defaultValue?: string;
  language: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dir = language === "HE" || language === "AR" ? "rtl" : "ltr";

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
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
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
          rows={16}
          dir={dir}
          placeholder="Write the article here. Select text and use the buttons above to make it bold, add a heading, or add a link."
          className="block w-full resize-y border-0 bg-white px-3.5 py-3 font-mono text-sm leading-relaxed text-slate-900 focus:outline-none focus:ring-0"
        />

        {showPreview ? (
          <div className="bg-white px-3.5 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              How it will look
            </div>
            {value.trim() === "" ? (
              <p className="text-sm text-slate-400">Nothing to preview yet.</p>
            ) : (
              <div
                dir={dir}
                className="axis-richtext"
                // Safe: renderRichText escapes all input and emits only its own tags.
                dangerouslySetInnerHTML={{ __html: renderRichText(value, dir) }}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
