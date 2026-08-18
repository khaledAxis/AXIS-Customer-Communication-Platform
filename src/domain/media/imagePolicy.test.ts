import { describe, it, expect } from "vitest";

import {
  MAX_IMAGE_BYTES,
  buildStoredFilename,
  isValidStoredFilename,
  sniffImageMime,
  validateImageUpload,
} from "./imagePolicy";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

describe("image content sniffing", () => {
  it("recognises the supported raster formats", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("does not recognise HTML or SVG as an image", () => {
    expect(sniffImageMime(HTML)).toBeNull();
    expect(sniffImageMime(SVG)).toBeNull();
  });

  it("does not recognise empty or truncated content", () => {
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("image upload validation", () => {
  it("accepts a genuine PNG", () => {
    const result = validateImageUpload({
      filename: "photo.png",
      declaredMimeType: "image/png",
      bytes: PNG,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extension).toBe("png");
  });

  it("accepts .jpeg as well as .jpg", () => {
    expect(
      validateImageUpload({ filename: "a.jpeg", declaredMimeType: "image/jpeg", bytes: JPEG }).ok,
    ).toBe(true);
  });

  it("ignores charset parameters on the declared type", () => {
    expect(
      validateImageUpload({ filename: "a.png", declaredMimeType: "image/png; charset=binary", bytes: PNG })
        .ok,
    ).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = validateImageUpload({
      filename: "a.png",
      declaredMimeType: "image/png",
      bytes: new Uint8Array([]),
    });
    expect(result).toMatchObject({ ok: false, reason: "EMPTY_FILE" });
  });

  it("rejects a file above the size limit", () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set(PNG);
    const result = validateImageUpload({
      filename: "big.png",
      declaredMimeType: "image/png",
      bytes: oversized,
    });
    expect(result).toMatchObject({ ok: false, reason: "TOO_LARGE" });
  });

  it("rejects SVG outright", () => {
    expect(
      validateImageUpload({ filename: "x.svg", declaredMimeType: "image/svg+xml", bytes: SVG }),
    ).toMatchObject({ ok: false, reason: "SVG_NOT_ALLOWED" });
  });

  it("rejects an unsupported type such as a PDF", () => {
    expect(
      validateImageUpload({ filename: "x.pdf", declaredMimeType: "application/pdf", bytes: PNG }),
    ).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });

  it("rejects HTML disguised as a PNG by name and declared type", () => {
    const result = validateImageUpload({
      filename: "evil.png",
      declaredMimeType: "image/png",
      bytes: HTML,
    });
    expect(result).toMatchObject({ ok: false, reason: "CONTENT_DOES_NOT_MATCH_TYPE" });
  });

  it("rejects content whose real type differs from the declared type", () => {
    expect(
      validateImageUpload({ filename: "a.png", declaredMimeType: "image/png", bytes: JPEG }),
    ).toMatchObject({ ok: false, reason: "CONTENT_DOES_NOT_MATCH_TYPE" });
  });

  it("rejects a mismatch between extension and declared type", () => {
    expect(
      validateImageUpload({ filename: "a.gif", declaredMimeType: "image/png", bytes: PNG }),
    ).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });

  it("gives a friendly, non-technical message on every rejection", () => {
    const result = validateImageUpload({
      filename: "x.svg",
      declaredMimeType: "image/svg+xml",
      bytes: SVG,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/MIME|magic|byte|null/i);
      expect(result.message.length).toBeGreaterThan(10);
    }
  });
});

describe("stored filename generation — path traversal is structurally impossible", () => {
  it("strips directory traversal from the client name", () => {
    const name = buildStoredFilename("../../../etc/passwd", "abc123", "png");
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(isValidStoredFilename(name)).toBe(true);
  });

  it("strips Windows absolute paths and drive letters", () => {
    const name = buildStoredFilename("C:\\Windows\\System32\\evil.png", "abc123", "png");
    expect(name).not.toContain(":");
    expect(name).not.toContain("\\");
    expect(isValidStoredFilename(name)).toBe(true);
  });

  it("removes null bytes and unicode tricks", () => {
    const name = buildStoredFilename("evil\u0000name\u202e.png", "abc123", "png");
    expect(name).not.toContain("\u0000");
    expect(name).not.toContain("\u202e");
    expect(isValidStoredFilename(name)).toBe(true);
  });

  it("always produces a name even when the original is unusable", () => {
    const name = buildStoredFilename("***", "abc123", "webp");
    expect(name.startsWith("image-")).toBe(true);
    expect(isValidStoredFilename(name)).toBe(true);
  });

  it("produces different names for the same upload", () => {
    expect(buildStoredFilename("photo.png", "aaa111", "png")).not.toBe(
      buildStoredFilename("photo.png", "bbb222", "png"),
    );
  });

  it("keeps the extension from the validated type, not the client name", () => {
    expect(buildStoredFilename("evil.html", "abc123", "png").endsWith(".png")).toBe(true);
  });

  it("rejects any filename the app did not generate", () => {
    for (const bad of [
      "../secret.png",
      "/etc/passwd",
      "evil.html",
      "shell.php",
      "a.png/../../x",
      "a b.png",
      "",
      "UPPER.PNG",
    ]) {
      expect(isValidStoredFilename(bad)).toBe(false);
    }
  });
});
