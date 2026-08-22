/**
 * RSS 2.0 / Atom 1.0 reader (ADR-0026).
 *
 * Deliberately a small, purpose-built reader rather than a general XML parser.
 *
 * The input is untrusted XML from the public internet, and general parsers are
 * dangerous there in a specific, well-documented way: XXE (`<!ENTITY x SYSTEM
 * "file:///etc/passwd">`) and entity-expansion bombs both need a parser that resolves
 * declarations. This one has no concept of a declaration to resolve, refuses any
 * document containing a DOCTYPE outright, and only ever copies text out of a fixed
 * set of elements. It cannot be talked into fetching anything, because it cannot
 * fetch. That is a stronger guarantee than configuring a general parser correctly and
 * hoping nobody reconfigures it.
 *
 * It is not a validating parser and does not try to be. A malformed feed yields fewer
 * items, never an exception and never a partial article presented as complete.
 *
 * Pure: no I/O, no network, no framework imports.
 */

export interface ParsedFeedItem {
  title: string;
  /** The article's link, as the feed gave it. Not yet validated or normalized. */
  link: string | null;
  /** Publisher's own identifier: RSS `<guid>` / Atom `<id>`. */
  externalId: string | null;
  /** Short excerpt SUPPLIED BY THE SOURCE. Never a copy of the whole article. */
  summary: string | null;
  author: string | null;
  publishedAt: Date | null;
  /** Enclosure / media thumbnail, when the feed declares one. */
  imageUrl: string | null;
}

export interface ParsedFeed {
  kind: "RSS" | "ATOM";
  title: string | null;
  /** Feed-level link to the publisher's site. */
  siteUrl: string | null;
  items: ParsedFeedItem[];
}

export type FeedParseProblem =
  | "EMPTY"
  | "NOT_XML"
  | "DOCTYPE_REFUSED"
  | "UNRECOGNISED_FORMAT";

export const FEED_PARSE_MESSAGE: Record<FeedParseProblem, string> = {
  EMPTY: "That address returned nothing.",
  NOT_XML: "That address did not return a feed.",
  DOCTYPE_REFUSED:
    "That feed contains a document type declaration, which is not accepted.",
  UNRECOGNISED_FORMAT:
    "That address returned something that is not an RSS or Atom feed.",
};

export type FeedParseResult =
  | { ok: true; feed: ParsedFeed }
  | { ok: false; problem: FeedParseProblem; message: string };

/** How many items are read from one feed. A feed claiming 10,000 gets the first 200. */
export const MAX_FEED_ITEMS = 200;
/** Excerpts are truncated: AXIS stores a summary, never a whole article (ADR-0026). */
export const MAX_SUMMARY_CHARS = 600;

// ---------------------------------------------------------------------------
// Minimal element extraction
// ---------------------------------------------------------------------------

/** Named XML entities a feed may legitimately use. No external entity is resolvable. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Only real, safe scalar values. Anything else stays literal rather than
      // becoming a surprise character.
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Strips any markup an excerpt carries, then collapses whitespace. */
export function stripMarkup(value: string): string {
  return decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapCdata(value: string): string {
  const match = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return match ? match[1] : value;
}

/** All occurrences of `<tag …>…</tag>` at any depth within `xml`. */
function blocks(xml: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    found.push(match[1]);
    if (found.length >= MAX_FEED_ITEMS * 2) break; // never scan unboundedly
  }
  return found;
}

/** Text content of the FIRST matching element, or null. */
function text(xml: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
    const match = xml.match(pattern);
    if (match) {
      const value = stripMarkup(unwrapCdata(match[1]));
      if (value !== "") return value;
    }
    // Self-closing form carrying its value in an attribute, e.g. Atom's <link href=…>.
    const selfClosing = xml.match(new RegExp(`<${tag}(\\s[^>]*)?/>`, "i"));
    if (selfClosing) {
      const href = attribute(selfClosing[0], "href");
      if (href) return href;
    }
  }
  return null;
}

function attribute(tagText: string, name: string): string | null {
  const match = tagText.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))
    ?? tagText.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"));
  return match ? decodeEntities(match[1]).trim() || null : null;
}

/** Every `<tag …/>` or `<tag …>` opening tag, for attribute-carrying elements. */
function openTags(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`, "gi");
  return xml.match(pattern) ?? [];
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // A feed claiming an article from the year 3000 is broken, not prophetic; a date
  // far in the future would sort to the top of the inbox forever.
  const oneDayAhead = Date.now() + 24 * 60 * 60 * 1000;
  if (parsed.getTime() > oneDayAhead) return null;
  return parsed;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Atom link selection
// ---------------------------------------------------------------------------

/**
 * Atom entries carry several `<link>` elements. `rel="alternate"` (or an absent rel,
 * which means alternate) is the article; `rel="self"` is the feed and `rel="enclosure"`
 * is an attachment. Picking the first one blindly is the classic Atom bug.
 */
function atomLink(entryXml: string): string | null {
  const links = openTags(entryXml, "link");
  let fallback: string | null = null;

  for (const tag of links) {
    const rel = (attribute(tag, "rel") ?? "alternate").toLowerCase();
    const href = attribute(tag, "href");
    if (!href) continue;
    if (rel === "alternate") return href;
    if (fallback === null && rel !== "self" && rel !== "enclosure") fallback = href;
  }
  return fallback;
}

function imageFrom(itemXml: string): string | null {
  // RSS enclosure, Media RSS thumbnail/content, in that order of specificity.
  for (const tag of ["enclosure", "media:thumbnail", "media:content"]) {
    for (const open of openTags(itemXml, tag)) {
      const type = attribute(open, "type");
      if (type && !type.toLowerCase().startsWith("image/")) continue;
      const url = attribute(open, "url") ?? attribute(open, "href");
      if (url) return url;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function parseFeed(raw: string): FeedParseResult {
  const fail = (problem: FeedParseProblem): FeedParseResult => ({
    ok: false,
    problem,
    message: FEED_PARSE_MESSAGE[problem],
  });

  if (typeof raw !== "string" || raw.trim() === "") return fail("EMPTY");

  // REFUSED, not stripped. A DOCTYPE in a feed has no legitimate purpose here, and
  // every entity-expansion and XXE attack needs one. Checked before anything else is
  // read, and on the raw text so a split declaration cannot slip past.
  if (/<!DOCTYPE/i.test(raw) || /<!ENTITY/i.test(raw)) {
    return fail("DOCTYPE_REFUSED");
  }

  if (!raw.includes("<")) return fail("NOT_XML");

  // Processing instructions and comments carry nothing this reader needs.
  const xml = raw.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");

  if (/<feed[\s>]/i.test(xml)) return { ok: true, feed: parseAtom(xml) };
  if (/<rss[\s>]/i.test(xml) || /<channel[\s>]/i.test(xml)) {
    return { ok: true, feed: parseRss(xml) };
  }
  return fail("UNRECOGNISED_FORMAT");
}

function parseRss(xml: string): ParsedFeed {
  const channel = blocks(xml, "channel")[0] ?? xml;
  // Read <item> blocks from the raw channel so a nested element cannot swallow one.
  const items = blocks(channel, "item")
    .slice(0, MAX_FEED_ITEMS)
    .map((item): ParsedFeedItem => {
      const guidBlock = item.match(/<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i);
      const guidValue = guidBlock ? stripMarkup(unwrapCdata(guidBlock[1])) : null;
      const guidIsPermalink =
        guidBlock !== null &&
        (attribute(guidBlock[0], "isPermaLink") ?? "true").toLowerCase() !== "false";

      const link = text(item, "link");

      return {
        title: text(item, "title") ?? "(untitled)",
        // A permalink guid is a usable link when <link> is missing.
        link: link ?? (guidIsPermalink ? guidValue : null),
        externalId: guidValue,
        summary: truncate(text(item, "description", "summary"), MAX_SUMMARY_CHARS),
        author: text(item, "dc:creator", "author"),
        publishedAt: parseDate(text(item, "pubDate", "dc:date")),
        imageUrl: imageFrom(item),
      };
    })
    // An article with no title at all is not something a person can review.
    .filter((item) => item.title.trim() !== "");

  return {
    kind: "RSS",
    title: text(channel.replace(/<item[\s\S]*?<\/item>/gi, ""), "title"),
    siteUrl: text(channel.replace(/<item[\s\S]*?<\/item>/gi, ""), "link"),
    items,
  };
}

function parseAtom(xml: string): ParsedFeed {
  const header = xml.replace(/<entry[\s\S]*?<\/entry>/gi, "");

  const items = blocks(xml, "entry")
    .slice(0, MAX_FEED_ITEMS)
    .map((entry): ParsedFeedItem => {
      const authorBlock = blocks(entry, "author")[0] ?? "";
      return {
        title: text(entry, "title") ?? "(untitled)",
        link: atomLink(entry),
        externalId: text(entry, "id"),
        // `<summary>` first: `<content>` is often the WHOLE article, which AXIS
        // deliberately does not store (ADR-0026 §copyright).
        summary: truncate(
          text(entry, "summary") ?? text(entry, "content"),
          MAX_SUMMARY_CHARS,
        ),
        author: authorBlock ? text(authorBlock, "name") : null,
        publishedAt: parseDate(text(entry, "published", "updated")),
        imageUrl: imageFrom(entry),
      };
    })
    .filter((item) => item.title.trim() !== "");

  return {
    kind: "ATOM",
    title: text(header, "title"),
    siteUrl: atomLink(header),
    items,
  };
}
