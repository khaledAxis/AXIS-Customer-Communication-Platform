import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getMediaStore, setMediaStoreForTesting } from "./index";

/**
 * Provider selection. No network and no filesystem writes — only which implementation
 * the factory chooses for a given MEDIA_PROVIDER.
 */

const original = { MEDIA_PROVIDER: process.env.MEDIA_PROVIDER, CLOUDINARY_URL: process.env.CLOUDINARY_URL };

beforeEach(() => setMediaStoreForTesting(undefined));

afterEach(() => {
  setMediaStoreForTesting(undefined);
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("media provider selection", () => {
  it("selects Cloudinary when MEDIA_PROVIDER=cloudinary", () => {
    process.env.MEDIA_PROVIDER = "cloudinary";
    expect(getMediaStore().provider).toBe("CLOUDINARY");
  });

  it("is case and whitespace tolerant", () => {
    process.env.MEDIA_PROVIDER = "  Cloudinary  ";
    expect(getMediaStore().provider).toBe("CLOUDINARY");
  });

  it("falls back to local development storage when unset", () => {
    delete process.env.MEDIA_PROVIDER;
    expect(getMediaStore().provider).toBe("LOCAL");
  });

  it("falls back to local storage for an unknown provider", () => {
    process.env.MEDIA_PROVIDER = "s3";
    expect(getMediaStore().provider).toBe("LOCAL");
  });

  it("reports Cloudinary as unavailable when CLOUDINARY_URL is missing", () => {
    process.env.MEDIA_PROVIDER = "cloudinary";
    delete process.env.CLOUDINARY_URL;
    const status = getMediaStore().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.message).toBe("Cloudinary image storage is not configured");
  });

  it("says plainly that local storage will not appear in email", () => {
    delete process.env.MEDIA_PROVIDER;
    const status = getMediaStore().checkConfiguration();
    expect(status.configured).toBe(true);
    expect(status.message).toMatch(/will not appear in email/i);
  });

  it("never exposes the CLOUDINARY_URL through the readiness status", () => {
    process.env.MEDIA_PROVIDER = "cloudinary";
    process.env.CLOUDINARY_URL = "cloudinary://KEY123:SECRET456@axis-demo";
    const status = JSON.stringify(getMediaStore().checkConfiguration());
    expect(status).not.toContain("SECRET456");
    expect(status).not.toContain("KEY123");
    expect(status).not.toContain("cloudinary://");
  });
});
