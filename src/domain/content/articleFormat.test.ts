import { describe, expect, it } from "vitest";
import { articlePlainText, normalizeArticleSource, presentArticle } from "./articleFormat";
import { renderRichText, richTextToPlain } from "./richText";

describe("article format adaptation", () => {
  it.each(["A plain article.\n\nSecond paragraph.", "## Heading\n\n**Bold** and [a link](https://example.com).\n\n- One\n- Two"])("preserves authored text/markup without format guessing changing it", source => {
    expect(normalizeArticleSource(source).source).toBe(source);
  });
  it.each([
    '<div class="hs-featured-image-wrapper"><a href="https://example.com/update"><img src="https://example.com/hero.jpg" style="width:50%;float:left" alt="Scanner"></a></div><p>Our <strong>surveying</strong> update.</p>',
    '&lt;div class="hs-featured-image-wrapper"&gt;&lt;img src="https://example.com/hero.jpg" alt="Scanner"&gt;&lt;/div&gt;&lt;p&gt;Our &lt;strong&gt;surveying&lt;/strong&gt; update.&lt;/p&gt;',
    '&amp;lt;img src="https://example.com/hero.jpg" alt="Scanner"&amp;gt;&amp;lt;p&amp;gt;Our &amp;lt;strong&amp;gt;surveying&amp;lt;/strong&amp;gt; update.&amp;lt;/p&amp;gt;',
    '&#60;img src="https://example.com/hero.jpg" alt="Scanner"&#62;&#x3c;p&#x3e;Our &#60;strong&#62;surveying&#60;/strong&#62; update.&#x3c;/p&#x3e;',
  ])("extracts readable publisher text and the embedded hero from encoded HTML", input => {
    const result = normalizeArticleSource(input);
    expect(articlePlainText(result.source)).toBe("Our surveying update.");
    expect(result.images).toEqual([{ url: "https://example.com/hero.jpg", alt: "Scanner" }]);
    const html = renderRichText(result.source);
    expect(html).toContain('<strong>surveying</strong>');
    expect(html).toContain('src="https://example.com/hero.jpg"');
    expect(html).not.toMatch(/hs-featured|float:left|&lt;(?:div|img)/);
    expect(normalizeArticleSource(result.source).source).toBe(result.source);
  });
  it("combines HTML, markup, plain text, quotes and lists in reading order", () => {
    const result = normalizeArticleSource('Plain introduction.\n\n## Local heading\n\n<p>HTML <b>bold</b> with **authored emphasis**.</p><ol><li>First</li><li>Second</li></ol><blockquote>Quoted insight</blockquote><p>Last paragraph.</p>');
    const html = renderRichText(result.source);
    expect(html).toContain('<h2'); expect(html).toContain('<ol'); expect(html).toContain('<blockquote');
    expect(html).toContain('<strong>authored emphasis</strong>');
    expect(html.indexOf('Plain introduction')).toBeLessThan(html.indexOf('Last paragraph'));
  });
  it("handles malformed fragments, character references and multilingual text", () => {
    const result = normalizeArticleSource('<div><p>עברית &amp; العربية <b>GPS</b><p>2 &lt; 3 and 5 &gt; 4');
    expect(articlePlainText(result.source)).toBe('עברית & العربية GPS 2 < 3 and 5 > 4');
    expect(renderRichText(result.source, 'rtl')).not.toContain('<div');
  });
  it("resolves relative and lazy pictures against the explicitly supplied article URL", () => {
    const result = normalizeArticleSource('<img src="data:image/gif;base64,x" data-src="../hero.png"><img srcset="/small.jpg 400w, /large.jpg 800w">', 'https://example.com/news/update');
    expect(result.images.map(image => image.url)).toEqual(['https://example.com/hero.png', 'https://example.com/small.jpg']);
  });
  it("keeps multiple images in order and never crops or stretches them", () => {
    const source = normalizeArticleSource('<p>Start</p><img src="https://example.com/one.jpg"><p>Middle</p><img src="https://example.com/two.jpg">').source;
    const html = renderRichText(source);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('height:auto'); expect(html).not.toContain('object-fit:cover');
    expect(richTextToPlain(source)).not.toContain('![');
  });
  it("resolves Markdown pictures and links against the supplied article URL", () => {
    const result = normalizeArticleSource('![Map](/map.jpg)\n\n[Details](../details)', 'https://example.com/news/article');
    expect(result.source).toBe('![Map](https://example.com/map.jpg)\n\n[Details](https://example.com/details)');
    expect(renderRichText(result.source)).toContain('src="https://example.com/map.jpg"');
  });
  it("preserves table cell order in readable rows", () => {
    const plain = articlePlainText('<table><tr><th>Model</th><th>Range</th></tr><tr><td>A1</td><td>40 m</td></tr></table>');
    expect(plain).toBe('Model | Range A1 | 40 m');
  });
  it("removes active content, page styling, forms and tracking pixels", () => {
    const result = normalizeArticleSource('<script>steal()</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><svg onload="evil()"><text>hidden</text></svg><form>Sign in</form><img src="https://example.com/pixel.gif" width="1"><div hidden>Hidden</div><p onclick="evil()">Actual article</p>');
    expect(result.source).toBe('Actual article');
    expect(result.images).toEqual([]);
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://127.0.0.1/a.jpg', 'https://10.0.0.1/a.jpg', 'https://user:password@example.com/a.jpg', 'http://169.254.169.254/a.jpg'])("refuses unsafe image/link targets: %s", url => {
    const result = normalizeArticleSource(`<a href="${url}">Read</a><img src="${url}">`);
    expect(result.images).toEqual([]); expect(result.source).toBe('Read');
    expect(renderRichText(`![picture](${url})`)).not.toContain('<img');
  });
  it("normalizes existing rows without mutating stored source or editorial fields", () => {
    const item = { title: 'Source headline', summary: '&lt;img src="https://example.com/hero.jpg"&gt;&lt;p&gt;Source excerpt&lt;/p&gt;', axisHeadline: 'AXIS headline', axisSummary: 'AXIS summary', imageUrl: null };
    const result = presentArticle(item);
    expect(result.summary).toBe('Source excerpt'); expect(result.imageUrl).toBe('https://example.com/hero.jpg');
    expect(result.title).toBe('Source headline'); expect(result.axisSummary).toBe('AXIS summary');
    expect(item.summary).toContain('&lt;'); expect(item.imageUrl).toBeNull();
  });
  it("bounds oversized input and deep nesting", () => {
    expect(normalizeArticleSource('a'.repeat(200_001)).truncated).toBe(true);
    expect(() => normalizeArticleSource('<div>'.repeat(1000) + 'text' + '</div>'.repeat(1000))).not.toThrow();
  });
});
