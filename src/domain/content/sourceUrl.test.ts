import { describe, expect, it } from "vitest";

import {
  isPermittedAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  validateSourceUrl,
} from "./sourceUrl";

/**
 * SSRF defence (ADR-0026).
 *
 * Every case below is a real way a server-side fetcher gets turned into a proxy into
 * somebody's private network. The rule under test is that each is REFUSED, and that
 * the refusal happens on shape alone — before DNS, before a socket, before anything
 * the attacker controls has been contacted.
 */

const refused = (url: string) => {
  const result = validateSourceUrl(url);
  expect(result.ok, `expected ${url} to be refused`).toBe(false);
  return result;
};

describe("scheme", () => {
  it("accepts public http and https", () => {
    expect(validateSourceUrl("https://example.com/feed.xml").ok).toBe(true);
    expect(validateSourceUrl("http://example.com/feed.xml").ok).toBe(true);
  });

  it("refuses every non-web scheme", () => {
    // file: reads the disk, gopher: was the classic SSRF gadget, data: smuggles a
    // payload past a naive check.
    for (const url of [
      "file:///etc/passwd",
      "file://C:/Windows/win.ini",
      "ftp://example.com/feed.xml",
      "gopher://example.com:6379/_INFO",
      "data:text/xml,<rss/>",
      "javascript:alert(1)",
      "jar:http://example.com!/",
    ]) {
      expect(refused(url).ok).toBe(false);
    }
  });

  it("refuses nonsense that is not a URL at all", () => {
    for (const value of ["", "   ", "not a url", "://missing-scheme"]) {
      expect(refused(value).ok).toBe(false);
    }
    expect(validateSourceUrl(null).ok).toBe(false);
    expect(validateSourceUrl(undefined).ok).toBe(false);
    expect(validateSourceUrl(42).ok).toBe(false);
  });
});

describe("loopback and localhost", () => {
  it("refuses localhost in every spelling", () => {
    for (const url of [
      "http://localhost/feed",
      "http://localhost:80/feed",
      "https://LOCALHOST/feed",
      "http://127.0.0.1/feed",
      "http://127.1.2.3/feed", // the whole 127/8 block is loopback
      "http://0.0.0.0/feed",
      "http://[::1]/feed",
      "http://api.localhost/feed",
    ]) {
      expect(refused(url).ok).toBe(false);
    }
  });
});

describe("private networks", () => {
  it("refuses RFC1918 space", () => {
    for (const host of ["10.0.0.1", "10.255.255.254", "192.168.1.1", "172.16.0.1", "172.31.255.1"]) {
      expect(refused(`http://${host}/feed`).ok).toBe(false);
    }
  });

  it("allows 172.32 and 172.15, which are NOT private", () => {
    // The 172.16/12 block is a common off-by-one; getting it wrong either lets an
    // internal address through or blocks legitimate public hosts.
    expect(validateSourceUrl("http://172.32.0.1/feed").ok).toBe(true);
    expect(validateSourceUrl("http://172.15.0.1/feed").ok).toBe(true);
  });

  it("refuses link-local and carrier-grade NAT", () => {
    expect(refused("http://169.254.1.1/feed").ok).toBe(false);
    expect(refused("http://100.64.0.1/feed").ok).toBe(false);
  });

  it("refuses private IPv6, including IPv4-mapped loopback", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    // The same loopback address wearing a different hat. A dotted-quad-only check
    // would wave both of these straight through.
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIpv6("::ffff:10.0.0.1")).toBe(true);
  });

  it("classifies IPv4 correctly at the boundaries", () => {
    expect(isPrivateIpv4("0.0.0.0")).toBe(true);
    expect(isPrivateIpv4("9.255.255.255")).toBe(false);
    expect(isPrivateIpv4("10.0.0.0")).toBe(true);
    expect(isPrivateIpv4("11.0.0.0")).toBe(false);
    expect(isPrivateIpv4("224.0.0.1")).toBe(true); // multicast
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    // Not four octets, or not numeric — never accidentally "private".
    expect(isPrivateIpv4("example.com")).toBe(false);
    expect(isPrivateIpv4("10.0.0")).toBe(false);
  });
});

describe("cloud metadata", () => {
  it("refuses the metadata endpoints by address AND by name", () => {
    // The single highest-value SSRF target: it hands out cloud credentials.
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://100.100.100.200/latest/meta-data/",
      "http://instance-data/latest/",
    ]) {
      expect(refused(url).ok).toBe(false);
    }
  });
});

describe("internal hostnames", () => {
  it("refuses names that only resolve inside a network", () => {
    for (const url of [
      "http://intranet/feed", // bare label, no dot
      "http://wiki.internal/feed",
      "http://nas.local/feed",
      "http://printer.lan/feed",
      "http://files.corp/feed",
      "http://box.home.arpa/feed",
    ]) {
      expect(refused(url).ok).toBe(false);
    }
  });
});

describe("credentials and ports", () => {
  it("refuses embedded credentials rather than stripping them", () => {
    const result = refused("https://user:secret@example.com/feed");
    expect(result.ok === false && result.problem).toBe("HAS_CREDENTIALS");
  });

  it("refuses non-standard ports", () => {
    // 6379 Redis, 5432 Postgres, 9200 Elasticsearch — the reason port filtering exists.
    for (const url of [
      "http://example.com:6379/",
      "http://example.com:5432/",
      "http://example.com:8080/feed",
    ]) {
      expect(refused(url).ok).toBe(false);
    }
    expect(validateSourceUrl("https://example.com:443/feed").ok).toBe(true);
    expect(validateSourceUrl("http://example.com:80/feed").ok).toBe(true);
  });
});

describe("resolved-address check", () => {
  it("refuses a resolved address in private space", () => {
    // The second half of the defence: a public NAME may resolve here.
    expect(isPermittedAddress("10.0.0.5")).toBe(false);
    expect(isPermittedAddress("127.0.0.1")).toBe(false);
    expect(isPermittedAddress("169.254.169.254")).toBe(false);
    expect(isPermittedAddress("::1")).toBe(false);
    expect(isPermittedAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPermittedAddress("")).toBe(false);
  });

  it("permits genuine public addresses", () => {
    expect(isPermittedAddress("8.8.8.8")).toBe(true);
    expect(isPermittedAddress("2606:4700:4700::1111")).toBe(true);
  });
});

describe("what a refusal tells the user", () => {
  it("explains itself without naming an internal address", () => {
    const result = validateSourceUrl("http://10.0.0.5/feed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/private network/i);
      // The message is shown to staff and written to a run log; it must not become a
      // way to learn AXIS's internal addressing.
      expect(result.message).not.toContain("10.0.0.5");
    }
  });
});
