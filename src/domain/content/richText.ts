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
function renderInline(escaped: string): string {
  let out = escaped;

  // [label](url) — the label keeps inline formatting; the URL is scheme-checked.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, rawUrl: string) => {
    // The URL arrives escaped (& -> &amp;), which is valid inside an attribute.
    const probe = rawUrl.replace(/&amp;/g, "&");
    if (!isSafeUrl(probe)) return whole; // leave unsafe links as literal text
    return `<a href="${rawUrl}" style="${S.a}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // **bold** before *italic* so the double marker wins.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  return out;
}

type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
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

    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: heading[1].length === 2 ? "h2" : "h3", text: heading[2] });
      continue;
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
export function renderRichText(source: string | null | undefined, dir: "ltr" | "rtl" = "ltr"): string {
  if (!source || source.trim() === "") return "";

  const escapedLines = escapeHtml(source).split(/\r?\n/);
  const listPadding = dir === "rtl" ? "padding-right:20px;" : "padding-left:20px;";

  return toBlocks(escapedLines)
    .map((block) => {
      switch (block.kind) {
        case "ul":
        case "ol": {
          const items = block.items
            .map((item) => `<li style="${S.li}">${renderInline(item)}</li>`)
            .join("");
          return `<${block.kind} style="${S.list}${listPadding}">${items}</${block.kind}>`;
        }
        case "h2":
          return `<h2 style="${S.h2}">${renderInline(block.text)}</h2>`;
        case "h3":
          return `<h3 style="${S.h3}">${renderInline(block.text)}</h3>`;
        default:
          return `<p style="${S.p}">${renderInline(block.text)}</p>`;
      }
    })
    .join("");
}

/** Plain-text alternative (multipart/alternative text part, and previews). */
export function richTextToPlain(source: string | null | undefined): string {
  if (!source) return "";
  return source
    .replace(/^#{2,3}\s+/gm, "")
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
