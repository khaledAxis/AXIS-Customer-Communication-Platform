import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { validateSourceUrl } from "./sourceUrl";

/** No DOM, scripts, fetch or publisher HTML output: only our editable markup. */
export const MAX_ARTICLE_INPUT = 200_000;
const HTML = /<\/?[a-z][a-z\d:-]*(?:\s[^<>]*|\/?)>/i;
const ENCODED_HTML = /&(?:amp;){0,2}(?:lt|#0*60|#x0*3c);\/?[a-z][a-z\d:-]*(?:\s|&(?:amp;){0,2}(?:gt|#0*62|#x0*3e);)/i;
const OMIT = new Set(["script", "style", "head", "title", "iframe", "object", "embed", "svg", "math", "canvas", "template", "noscript", "form", "input", "button", "select", "textarea"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "figure", "figcaption", "address"]);
type Node = DefaultTreeAdapterMap["node"];

export interface ArticleImage { url: string; alt: string }
export interface ArticleFormat {
  source: string;
  format: "TEXT" | "MARKUP" | "HTML";
  images: ArticleImage[];
  truncated: boolean;
}

/** Decode character references as TEXT, never parse the decoded result as output HTML. */
function decode(value: string): string {
  return parseFragment(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .childNodes.map(node => "value" in node ? node.value : "").join("");
}

export function articleUrl(value: string | null | undefined, baseUrl?: string | null): string | null {
  if (!value || /[\u0000-\u0020<>"'`]/.test(value.trim())) return null;
  try {
    const url = new URL(value.trim(), baseUrl || undefined).href;
    return validateSourceUrl(url).ok ? url.replace(/\(/g, "%28").replace(/\)/g, "%29") : null;
  } catch { return null; }
}

/** Accept plain/restricted markup, HTML, encoded HTML, and mixtures in one article. */
export function normalizeArticleSource(input: string | null | undefined, baseUrl?: string | null): ArticleFormat {
  let value = (input ?? "").slice(0, MAX_ARTICLE_INPUT).replace(/\r\n?/g, "\n")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const truncated = (input?.length ?? 0) > MAX_ARTICLE_INPUT;
  // Feeds sometimes wrap already escaped HTML in another XML entity layer.
  for (let pass = 0; pass < 3 && ENCODED_HTML.test(value); pass++) value = decode(value);
  const images: ArticleImage[] = [];
  if (!HTML.test(value)) {
    if (baseUrl) value = value.replace(/(!?\[[^\]]*\])\(([^)\s]+)\)/g, (token, label: string, target: string) => {
      const url = articleUrl(target, baseUrl);
      return url ? `${label}(${url})` : token;
    });
    for (const match of value.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const url = articleUrl(match[2], baseUrl);
      if (url && images.length < 20) images.push({ url, alt: match[1] });
    }
    return { source: value.trim(), images, truncated,
      format: /(^#{1,6}\s|\*\*|^[-*>]\s|\]\()/m.test(value) ? "MARKUP" : "TEXT" };
  }

  let visited = 0;
  let complexityExceeded = false;
  const walk = (node: Node, depth = 0): string => {
    if (++visited > 20_000 || depth > 80) { complexityExceeded = true; return ""; }
    if ("value" in node) return node.value;
    if (!("childNodes" in node)) return "";
    if (!("tagName" in node)) return node.childNodes.map(child => walk(child, depth + 1)).join("");
    const tag = node.tagName.toLowerCase();
    const attr = (name: string) => node.attrs.find(item => item.name === name)?.value;
    if (OMIT.has(tag) || attr("hidden") !== undefined || attr("aria-hidden") === "true" ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr("style") ?? "")) return "";
    if (tag === "img") {
      if ([attr("width"), attr("height")].some(size => size !== undefined && /^\d+(?:px)?$/.test(size) && Number.parseInt(size) <= 2)) return "";
      const candidates = [attr("src"), attr("data-src"), attr("data-original"),
        ...(attr("srcset") ?? "").split(",").map(item => item.trim().split(/\s+/)[0])];
      const url = candidates.map(candidate => articleUrl(candidate, baseUrl)).find(Boolean);
      if (!url || images.length >= 20) return "";
      const alt = (attr("alt") ?? "").replace(/[\[\]\r\n]/g, " ").slice(0, 200);
      images.push({ url, alt });
      return `\n\n![${alt}](${url})\n\n`;
    }
    const content = node.childNodes.map(child => walk(child, depth + 1)).join("");
    if (tag === "br") return "\n\n";
    if (tag === "hr") return "\n\n";
    if (/^h[1-6]$/.test(tag)) return `\n\n${Number(tag[1]) <= 2 ? "##" : "###"} ${content.trim()}\n\n`;
    if (tag === "strong" || tag === "b") return content.trim() ? `**${content.trim()}**` : "";
    if (tag === "em" || tag === "i") return content.trim() ? `*${content.trim()}*` : "";
    if (tag === "a") {
      const href = attr("href");
      const url = articleUrl(href, baseUrl) ?? (href && /^mailto:[^\s<>"'`]+$/i.test(href) ? href : null);
      // An image inside a link stays an image; avoid nested markup that changes its target.
      return url && content.trim() && !content.includes("![") ? `[${content.trim().replace(/[\[\]]/g, "")}](${url})` : content;
    }
    if (tag === "li") {
      const parent = node.parentNode;
      const ordered = parent && "tagName" in parent && parent.tagName === "ol";
      return `\n${ordered ? "1." : "-"} ${content.trim().replace(/\n+/g, " ")}\n`;
    }
    if (tag === "ul" || tag === "ol") return `\n\n${content.trim().replace(/\n\s*\n/g, "\n")}\n\n`;
    if (tag === "blockquote") return `\n\n> ${content.trim().replace(/\n+/g, " ")}\n\n`;
    // Tables retain row/cell boundaries in a compact, readable text form.
    if (tag === "td" || tag === "th") return `${content.trim()} | `;
    if (tag === "tr") return `\n\n${content.trim().replace(/\s*\|\s*$/, "")}\n\n`;
    if (BLOCK.has(tag)) return `\n\n${content.trim()}\n\n`;
    return content;
  };
  const source = walk(parseFragment(value)).replace(/[\t ]+\n/g, "\n").replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return { source, images, format: "HTML", truncated: truncated || complexityExceeded };
}

/** Plain labels/excerpts are normalized independently of the rich article body. */
export function articlePlainText(input: string | null | undefined): string {
  return normalizeArticleSource(input).source
    .replace(/!\[[^\]]*\]\([^)\s]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "").replace(/^>\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/\s+/g, " ").trim();
}

/** Read compatibility for existing imported excerpts; never writes or changes review state. */
export function presentArticle<T extends { title: string; summary?: string | null; imageUrl?: string | null; externalUrl?: string | null; axisHeadline?: string | null; axisSummary?: string | null }>(item: T): T {
  const summary = normalizeArticleSource(item.summary, item.externalUrl);
  return { ...item, title: articlePlainText(item.title),
    summary: articlePlainText(summary.source) || null,
    imageUrl: item.imageUrl || summary.images[0]?.url || null };
}
