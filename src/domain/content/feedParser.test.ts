import { describe, expect, it } from "vitest";

import { MAX_SUMMARY_CHARS, parseFeed, stripMarkup } from "./feedParser";

/**
 * The feed reader (ADR-0026).
 *
 * The input is untrusted XML from the public internet, so half of these tests are
 * about what the reader REFUSES to do, and the other half about not losing articles
 * to ordinary real-world feed sloppiness.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Geospatial News</title>
    <link>https://example.com</link>
    <item>
      <title>New scanner released</title>
      <link>https://example.com/posts/scanner</link>
      <guid isPermaLink="false">post-0001</guid>
      <description>A short excerpt supplied by the publisher.</description>
      <pubDate>Mon, 03 Aug 2026 09:00:00 GMT</pubDate>
      <dc:creator>A. Writer</dc:creator>
      <enclosure url="https://cdn.example.com/scanner.jpg" type="image/jpeg" length="10"/>
    </item>
    <item>
      <title><![CDATA[Firmware 2.4 & beyond]]></title>
      <link>https://example.com/posts/firmware</link>
      <guid isPermaLink="true">https://example.com/posts/firmware</guid>
      <description><![CDATA[<p>Markup <b>inside</b> the excerpt.</p>]]></description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <link rel="self" href="https://example.com/atom.xml"/>
  <link rel="alternate" href="https://example.com"/>
  <entry>
    <title>Mapping update</title>
    <link rel="self" href="https://example.com/atom/entry/1"/>
    <link rel="enclosure" href="https://cdn.example.com/big.zip"/>
    <link rel="alternate" href="https://example.com/mapping-update"/>
    <id>tag:example.com,2026:entry-1</id>
    <summary>A concise summary.</summary>
    <published>2026-08-01T10:00:00Z</published>
    <author><name>B. Author</name></author>
  </entry>
</feed>`;

describe("RSS", () => {
  it("reads title, link, guid, excerpt, author and date", () => {
    const result = parseFeed(RSS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.feed.kind).toBe("RSS");
    expect(result.feed.title).toBe("Example Geospatial News");
    expect(result.feed.items).toHaveLength(2);

    const [first] = result.feed.items;
    expect(first.title).toBe("New scanner released");
    expect(first.link).toBe("https://example.com/posts/scanner");
    expect(first.externalId).toBe("post-0001");
    expect(first.summary).toBe("A short excerpt supplied by the publisher.");
    expect(first.author).toBe("A. Writer");
    expect(first.publishedAt?.toISOString()).toBe("2026-08-03T09:00:00.000Z");
    expect(first.imageUrl).toBe("https://cdn.example.com/scanner.jpg");
  });

  it("unwraps CDATA and decodes entities in a title", () => {
    const result = parseFeed(RSS);
    if (!result.ok) throw new Error("expected a feed");
    expect(result.feed.items[1].title).toBe("Firmware 2.4 & beyond");
  });

  it("strips markup out of an excerpt", () => {
    const result = parseFeed(RSS);
    if (!result.ok) throw new Error("expected a feed");
    // A summary lands in an AXIS newsletter and in a review screen; publisher markup
    // has no business in either.
    expect(result.feed.items[1].summary).toBe("Markup inside the excerpt.");
  });

  it("does not confuse the channel title with an item title", () => {
    const result = parseFeed(RSS);
    if (!result.ok) throw new Error("expected a feed");
    expect(result.feed.items.map((item) => item.title)).not.toContain(
      "Example Geospatial News",
    );
  });
});

describe("Atom", () => {
  it("reads an entry and picks the ALTERNATE link", () => {
    const result = parseFeed(ATOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.feed.kind).toBe("ATOM");
    const [entry] = result.feed.items;
    expect(entry.title).toBe("Mapping update");
    // Not rel="self" (the feed) and not rel="enclosure" (an attachment) — the classic
    // Atom bug is taking whichever <link> comes first.
    expect(entry.link).toBe("https://example.com/mapping-update");
    expect(entry.externalId).toBe("tag:example.com,2026:entry-1");
    expect(entry.summary).toBe("A concise summary.");
    expect(entry.author).toBe("B. Author");
    expect(entry.publishedAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("prefers <summary> over <content>, which is often the whole article", () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>T</title><id>1</id>
      <summary>Short excerpt.</summary>
      <content>${"The entire article body. ".repeat(50)}</content>
    </entry></feed>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error("expected a feed");
    // AXIS stores an excerpt and links to the source; it does not republish (ADR-0026).
    expect(result.feed.items[0].summary).toBe("Short excerpt.");
  });

  it("truncates a long excerpt rather than storing an article", () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>T</title><id>1</id><summary>${"word ".repeat(500)}</summary>
    </entry></feed>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error("expected a feed");
    expect((result.feed.items[0].summary ?? "").length).toBeLessThanOrEqual(
      MAX_SUMMARY_CHARS,
    );
  });
});

describe("hostile input", () => {
  it("REFUSES a DOCTYPE outright (XXE)", () => {
    const xxe = `<?xml version="1.0"?>
      <!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <rss version="2.0"><channel><item><title>&xxe;</title></item></channel></rss>`;
    const result = parseFeed(xxe);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("DOCTYPE_REFUSED");
  });

  it("REFUSES an entity-expansion bomb", () => {
    const bomb = `<?xml version="1.0"?>
      <!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>
      <rss><channel><item><title>&lol2;</title></item></channel></rss>`;
    const result = parseFeed(bomb);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("DOCTYPE_REFUSED");
  });

  it("never resolves an external entity even without a DOCTYPE", () => {
    const feed = `<rss version="2.0"><channel><item>
      <title>&xxe;</title><link>https://example.com/a</link>
    </item></channel></rss>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error("expected a feed");
    // An unknown entity stays literal. There is no resolution step to exploit.
    expect(result.feed.items[0].title).toBe("&xxe;");
  });

  it("reports an HTML page as not a feed rather than parsing it hopefully", () => {
    const result = parseFeed("<html><body><h1>404 Not Found</h1></body></html>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("UNRECOGNISED_FORMAT");
  });

  it("returns fewer items rather than throwing on a truncated feed", () => {
    const truncated = `<rss version="2.0"><channel><item><title>Half an`;
    const result = parseFeed(truncated);
    // Either "not a feed" or a feed with no complete items — never an exception.
    if (result.ok) expect(result.feed.items).toHaveLength(0);
  });

  it("refuses an empty body", () => {
    expect(parseFeed("").ok).toBe(false);
    expect(parseFeed("   ").ok).toBe(false);
  });

  it("ignores an article with no title, which nobody could review", () => {
    const feed = `<rss version="2.0"><channel>
      <item><link>https://example.com/a</link></item>
      <item><title>Real</title><link>https://example.com/b</link></item>
    </channel></rss>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error("expected a feed");
    expect(result.feed.items.map((i) => i.title)).toEqual(["(untitled)", "Real"]);
  });

  it("refuses a publication date far in the future", () => {
    const feed = `<rss version="2.0"><channel><item>
      <title>T</title><link>https://example.com/a</link>
      <pubDate>Mon, 03 Aug 3026 09:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const result = parseFeed(feed);
    if (!result.ok) throw new Error("expected a feed");
    // Otherwise one broken feed pins itself to the top of the inbox forever.
    expect(result.feed.items[0].publishedAt).toBeNull();
  });
});

describe("stripMarkup", () => {
  it("removes tags, decodes entities and collapses whitespace", () => {
    expect(stripMarkup("<p>Hello   &amp;\n  goodbye</p>")).toBe("Hello & goodbye");
  });

  it("leaves no executable fragment behind", () => {
    expect(stripMarkup("<script>alert(1)</script>text")).toBe("alert(1) text");
  });
});
