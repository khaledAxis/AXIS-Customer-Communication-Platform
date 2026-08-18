import { describe, it, expect } from "vitest";

import { isPublicHttpsUrl } from "./publicUrl";

describe("public HTTPS URL check", () => {
  it.each([
    "https://res.cloudinary.com/axis/image/upload/v1/logo.png",
    "https://www.axis-gps.com/logo.svg",
    "https://cdn.example.co.uk/a/b/c.png?v=2",
  ])("accepts the public HTTPS URL %j", (url) => {
    expect(isPublicHttpsUrl(url)).toBe(true);
  });

  it.each([
    ["plain http", "http://res.cloudinary.com/axis/image/upload/v1/logo.png"],
    ["localhost", "https://localhost:3000/logo.png"],
    ["loopback ip", "https://127.0.0.1/logo.png"],
    ["all-zeros", "https://0.0.0.0/logo.png"],
    ["ipv6 loopback", "https://[::1]/logo.png"],
    ["private 10.x", "https://10.0.0.5/logo.png"],
    ["private 192.168.x", "https://192.168.1.20/logo.png"],
    ["private 172.16.x", "https://172.16.4.4/logo.png"],
    ["link-local", "https://169.254.1.1/logo.png"],
    ["carrier-grade NAT", "https://100.70.0.1/logo.png"],
    ["mDNS .local", "https://axis-nas.local/logo.png"],
    ["internal suffix", "https://files.internal/logo.png"],
    ["bare hostname", "https://intranet/logo.png"],
    ["data uri", "data:image/png;base64,AAAA"],
    ["javascript", "javascript:alert(1)"],
    ["not a url", "logo.png"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(isPublicHttpsUrl(url)).toBe(false);
  });

  it("does not reject a public address that merely looks private", () => {
    // 172.32.x is OUTSIDE the 172.16-31 private block.
    expect(isPublicHttpsUrl("https://172.32.0.1/logo.png")).toBe(true);
    expect(isPublicHttpsUrl("https://11.0.0.1/logo.png")).toBe(true);
  });

  it("handles null and undefined", () => {
    expect(isPublicHttpsUrl(null)).toBe(false);
    expect(isPublicHttpsUrl(undefined)).toBe(false);
  });
});
