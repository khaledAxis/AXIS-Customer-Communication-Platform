import { describe, expect, it } from "vitest";

import { articleIdentity, isIdentifiable, normalizeArticleUrl } from "./urlIdentity";

/**
 * Article identity (ADR-0026).
 *
 * The rule under test is asymmetric on purpose: collapse what is PROVABLY the same
 * URL, and never merge on resemblance. Two publishers covering the same launch are
 * two articles, and AXIS may legitimately want to link either one.
 */

describe("normalizing an article URL", () => {
  it("treats http and https as the same article", () => {
    expect(normalizeArticleUrl("http://example.com/a")).toBe(
      normalizeArticleUrl("https://example.com/a"),
    );
  });

  it("ignores www., case, the default port and a trailing slash", () => {
    const canonical = normalizeArticleUrl("https://example.com/posts/a");
    for (const variant of [
      "https://www.example.com/posts/a",
      "https://EXAMPLE.com/posts/a",
      "https://example.com:443/posts/a",
      "https://example.com/posts/a/",
    ]) {
      expect(normalizeArticleUrl(variant)).toBe(canonical);
    }
  });

  it("strips campaign tracking parameters", () => {
    expect(
      normalizeArticleUrl(
        "https://example.com/a?utm_source=news&utm_campaign=aug&fbclid=xyz",
      ),
    ).toBe(normalizeArticleUrl("https://example.com/a"));
  });

  it("KEEPS parameters that identify the article", () => {
    // `?id=12` very often IS the article. Dropping it would merge unrelated pages.
    expect(normalizeArticleUrl("https://example.com/read?id=12")).not.toBe(
      normalizeArticleUrl("https://example.com/read?id=13"),
    );
  });

  it("sorts remaining parameters so order cannot create a duplicate", () => {
    expect(normalizeArticleUrl("https://example.com/a?b=2&a=1")).toBe(
      normalizeArticleUrl("https://example.com/a?a=1&b=2"),
    );
  });

  it("ignores the fragment", () => {
    expect(normalizeArticleUrl("https://example.com/a#comments")).toBe(
      normalizeArticleUrl("https://example.com/a"),
    );
  });

  it("keeps genuinely different paths apart", () => {
    expect(normalizeArticleUrl("https://example.com/a")).not.toBe(
      normalizeArticleUrl("https://example.com/b"),
    );
    expect(normalizeArticleUrl("https://example.com/a")).not.toBe(
      normalizeArticleUrl("https://other.com/a"),
    );
  });

  it("returns null for what it cannot parse, and null never matches", () => {
    for (const value of ["", "   ", "not a url", "javascript:alert(1)", null, undefined]) {
      expect(normalizeArticleUrl(value)).toBeNull();
    }
  });
});

describe("article identity", () => {
  it("prefers the publisher's canonical URL over the syndicated link", () => {
    const identity = articleIdentity({
      externalId: null,
      canonicalUrl: "https://example.com/real",
      externalUrl: "https://syndicator.example/copy?utm_source=x",
    });
    expect(identity.normalizedUrl).toBe(normalizeArticleUrl("https://example.com/real"));
  });

  it("keeps the publisher's own id when there is one", () => {
    const identity = articleIdentity({
      externalId: "  post-1  ",
      externalUrl: "https://example.com/a",
    });
    expect(identity.externalId).toBe("post-1");
  });

  it("refuses to identify an article with neither an id nor a usable URL", () => {
    // Such an article would be re-created on every poll, so it is not ingested at all.
    expect(isIdentifiable(articleIdentity({ externalId: "", externalUrl: "nonsense" }))).toBe(
      false,
    );
    expect(isIdentifiable(articleIdentity({ externalId: "x" }))).toBe(true);
    expect(isIdentifiable(articleIdentity({ externalUrl: "https://example.com/a" }))).toBe(
      true,
    );
  });

  it("does NOT merge different articles that merely have similar titles", () => {
    const a = articleIdentity({ externalUrl: "https://example.com/scanner-launch" });
    const b = articleIdentity({ externalUrl: "https://other.com/scanner-launch" });
    expect(a.normalizedUrl).not.toBe(b.normalizedUrl);
  });
});
