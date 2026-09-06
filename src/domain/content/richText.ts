/**
 * Restricted rich-text → email-safe HTML.
 *
 * SECURITY MODEL — XSS-safe by construction, not by sanitizing:
 * the editor stores a small markup source (never raw client HTML), and this
 * renderer ESCAPES the entire source first, then emits only tags it generates
 * itself. Because every `<` in user input becomes `&lt;` before any pattern is
 * applied, a hostile payload cannot produce an element or attribute. There is no
 * allow-list to bypass and no HTML parser to confuse.
 *
 * The supported subset is deliberately what email clients render reliably:
 * headings, bold, italic, links, bullet lists, numbered lists, paragraphs.
 *
 * Pure: no I/O, no framework imports (CLAUDE.md — `domain/` stays testable).
 */

import { articleUrl } from "./articleFormat";
import { emailDeliveryUrl } from "../media/cloudinaryDelivery";
import { inlineDirectionFragments } from "./inlineDirection";

/** Only these URL schemes may appear in a generated href. */
const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s"'<>`]+$/i;

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whole Latin phrases remain readable within Hebrew/Arabic, including in Outlook. */
export function escapeWithLtrIsolation(raw: string, dir: "rtl" | "ltr"): string {
  if (dir === "ltr") return escapeHtml(raw);
  const latin = /(?:[A-Za-z]|[+-]?\d+(?:[.,:/–-]\d+)*[ \t]*(?=[A-Za-z]))[A-Za-z0-9²³°%@._+':/-]*(?:[ \t,&]+[A-Za-z0-9][A-Za-z0-9²³°%@._+':/-]*)*/g;
  let result = ""; let index = 0;
  for (const match of raw.matchAll(latin)) {
    const start = match.index ?? 0;
    result += escapeHtml(raw.slice(index, start)) + `<span dir="ltr">${escapeHtml(match[0])}</span>`;
    index = start + match[0].length;
  }
  return result + escapeHtml(raw.slice(index));
}

/**
 * True when a URL is safe to place in an href. Rejects `javascript:`, `data:`,
 * `vbscript:` and anything else outside the scheme allow-list.
 */
export function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url.trim());
}

/** Email-safe inline styles — email clients ignore <style> blocks and classes. */
const S = {
  h2: "margin:0 0 12px;font-size:20px;line-height:1.35;font-weight:700;color:#0f172a;",
  h3: "margin:0 0 10px;font-size:17px;line-height:1.4;font-weight:700;color:#0f172a;",
  p: "margin:0 0 12px;font-size:15px;line-height:1.65;color:#334155;",
  list: "margin:0 0 12px;padding:0;font-size:15px;line-height:1.65;color:#334155;",
  li: "margin:0 0 6px;",
  a: "color:#0b5cab;text-decoration:underline;",
} as const;

/**
 * Inline formatting. Input MUST already be HTML-escaped — this only recognises
 * markers that survive escaping (`**`, `*`, `[`, `]`, `(`, `)`).
 */
function renderInline(escaped: string, dir: "ltr" | "rtl", target: "email" | "browser"): string {
  const isolate = (text: string) => {
    const raw = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    return target === "email" ? escapeWithLtrIsolation(raw, dir) : inlineDirectionFragments(raw, dir)
      .map(part => part.ltr ? `<bdi dir="ltr">${escapeHtml(part.text)}</bdi>` : escapeHtml(part.text)).join("");
  };
  // Replace source tokens once: formatting markers inside a URL cannot rewrite a
  // generated attribute. Only labels receive inline emphasis.
  const emphasis = (text: string) => {
    let result = ""; let index = 0;
    for (const match of text.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*/g)) {
      result += isolate(text.slice(index, match.index)) + (match[1] ? `<strong>${isolate(match[1])}</strong>` : `<em>${isolate(match[2])}</em>`);
      index = match.index + match[0].length;
    }
    return result + isolate(text.slice(index));
  };
  const renderToken = (token: string) => {
    const link = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
    if (!link) return emphasis(token);
    const [, image, label, rawUrl] = link;
    const probe = rawUrl.replace(/&amp;/g, "&");
    if (image) {
      const url = articleUrl(probe);
      if (!url) return isolate(label);
      return `<img src="${escapeHtml(emailDeliveryUrl(url) ?? url)}" alt="${label}" width="540" style="display:block;width:100%;max-width:540px;height:auto;margin:12px 0;border:0;" />`;
    }
    if (!isSafeUrl(probe)) return isolate(token);
    return `<a href="${rawUrl}" style="${S.a}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`;
  };
  let result = ""; let index = 0;
  for (const match of escaped.matchAll(/!?\[[^\]]*\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*/g)) {
    result += isolate(escaped.slice(index, match.index)) + renderToken(match[0]);
    index = match.index + match[0].length;
  }
  return result + isolate(escaped.slice(index));
}

type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

/** Group escaped lines into blocks. Blank lines separate paragraphs. */
function toBlocks(escapedLines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (const line of escapedLines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: heading[1].length <= 2 ? "h2" : "h3", text: heading[2] });
      continue;
    }

    if (trimmed.startsWith("&gt; ")) {
      flushParagraph(); blocks.push({ kind: "quote", text: trimmed.slice(5) }); continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ol") last.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

/**
 * Render the restricted source to deterministic, email-safe HTML.
 * Same input always yields byte-identical output (no dates, no randomness).
 */
export function renderRichText(source: string | null | undefined, dir: "ltr" | "rtl" = "ltr", target: "email" | "browser" = "email"): string {
  if (!source || source.trim() === "") return "";

  const escapedLines = escapeHtml(source).split(/\r?\n/);
  const listPadding = dir === "rtl" ? "padding-right:20px;" : "padding-left:20px;";

  return toBlocks(escapedLines)
    .map((block) => {
      switch (block.kind) {
        case "ul":
        case "ol": {
          const items = block.items
            .map((item) => `<li style="${S.li}">${renderInline(item, dir, target)}</li>`)
            .join("");
          return `<${block.kind} style="${S.list}${listPadding}">${items}</${block.kind}>`;
        }
        case "h2":
          return `<h2 style="${S.h2}">${renderInline(block.text, dir, target)}</h2>`;
        case "h3":
          return `<h3 style="${S.h3}">${renderInline(block.text, dir, target)}</h3>`;
        case "quote":
          return `<blockquote style="${S.p}margin:12px 0;padding:12px 16px;background:#f1f5f9;">${renderInline(block.text, dir, target)}</blockquote>`;
        default:
          return `<p style="${S.p}">${renderInline(block.text, dir, target)}</p>`;
      }
    })
    .join("");
}

/** Plain-text alternative (multipart/alternative text part, and previews). */
export function richTextToPlain(source: string | null | undefined): string {
  if (!source) return "";
  return source
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Short preview/summary text, trimmed on a word boundary. */
export function excerpt(source: string | null | undefined, maxChars = 160): string {
  const plain = richTextToPlain(source).replace(/\s+/g, " ").trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
