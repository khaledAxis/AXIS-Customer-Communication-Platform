import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { CLOUDINARY_FOLDER, CloudinaryMediaStore } from "./cloudinaryMediaStore";
import { MediaUploadError } from "./mediaStore";

/**
 * Configuration and guard behaviour. Cloudinary is MOCKED throughout — no test ever
 * performs a live upload or contacts the network.
 */

const uploadStreamMock = vi.fn();
const configMock = vi.fn();

vi.mock("cloudinary", () => ({
  v2: {
    config: (...args: unknown[]) => configMock(...args),
    uploader: {
      upload_stream: (...args: unknown[]) => uploadStreamMock(...args),
    },
  },
}));

/** A fake stream that hands the callback a canned Cloudinary response. */
function respondWith(response: unknown, error: unknown = null) {
  uploadStreamMock.mockImplementation((_options: unknown, callback: (e: unknown, r: unknown) => void) => ({
    end: () => callback(error, response),
  }));
}

const REAL_URL = "cloudinary://123456789012345:abcdefghijklmnopqrstuvwxyz1@axis-demo";
const KEYS = ["MEDIA_PROVIDER", "CLOUDINARY_URL"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) original[key] = process.env[key];
  uploadStreamMock.mockReset();
  configMock.mockReset();
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("Cloudinary store — configuration readiness", () => {
  it("is ready with a valid provider and URL", () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: REAL_URL });
    const status = new CloudinaryMediaStore().checkConfiguration();
    expect(status.configured).toBe(true);
    expect(status.message).toBe("Cloudinary image storage ready");
    expect(status.problems).toEqual([]);
  });

  it("is not configured when CLOUDINARY_URL is missing", () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary" });
    const status = new CloudinaryMediaStore().checkConfiguration();
    expect(status.configured).toBe(false);
    expect(status.message).toBe("Cloudinary image storage is not configured");
    expect(status.problems.join(" ")).toMatch(/CLOUDINARY_URL/);
  });

  it("is not configured when MEDIA_PROVIDER is something else", () => {
    setEnv({ MEDIA_PROVIDER: "local", CLOUDINARY_URL: REAL_URL });
    expect(new CloudinaryMediaStore().checkConfiguration().configured).toBe(false);
  });

  it("rejects a malformed CLOUDINARY_URL", () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: "not-a-cloudinary-url" });
    const status = new CloudinaryMediaStore().checkConfiguration();
    expect(status.configured).toBe(false);
  });

  it("NEVER echoes the secret back in a problem message", () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: "cloudinary://SECRETKEY:SECRETVALUE" });
    const status = new CloudinaryMediaStore().checkConfiguration();
    for (const problem of status.problems) {
      expect(problem).not.toContain("SECRETKEY");
      expect(problem).not.toContain("SECRETVALUE");
    }
    expect(JSON.stringify(status)).not.toContain("SECRETVALUE");
  });

  it("checks configuration without contacting Cloudinary", () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: REAL_URL });
    new CloudinaryMediaStore().checkConfiguration();
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});

describe("Cloudinary store — upload", () => {
  beforeEach(() => setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: REAL_URL }));

  it("uploads into the AXIS folder with a generated public id", async () => {
    respondWith({
      secure_url: "https://res.cloudinary.com/axis-demo/image/upload/v1/axis-newsletter/content/x.png",
      public_id: "axis-newsletter/content/x",
      bytes: 1234,
    });

    await new CloudinaryMediaStore().put({
      originalName: "My Holiday Photo.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });

    const options = uploadStreamMock.mock.calls[0][0] as {
      folder: string;
      public_id: string;
      tags: string[];
      overwrite: boolean;
    };
    expect(options.folder).toBe(CLOUDINARY_FOLDER);
    expect(options.tags).toEqual(["axis-newsletter", "content"]);
    expect(options.overwrite).toBe(false);
    // A readable slug, but identity comes from random hex — not the client filename.
    expect(options.public_id).toMatch(/^my-holiday-photo-[0-9a-f]{16}$/);
  });

  it("generates a different public id every time", async () => {
    respondWith({ secure_url: "https://res.cloudinary.com/a/image/upload/v1/x.png", bytes: 1 });
    const store = new CloudinaryMediaStore();
    const input = { originalName: "photo.png", mimeType: "image/png", bytes: PNG_BYTES };
    await store.put(input);
    await store.put(input);
    const first = (uploadStreamMock.mock.calls[0][0] as { public_id: string }).public_id;
    const second = (uploadStreamMock.mock.calls[1][0] as { public_id: string }).public_id;
    expect(first).not.toBe(second);
  });

  it("strips traversal from the client filename", async () => {
    respondWith({ secure_url: "https://res.cloudinary.com/a/image/upload/v1/x.png", bytes: 1 });
    await new CloudinaryMediaStore().put({
      originalName: "../../etc/passwd.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });
    const publicId = (uploadStreamMock.mock.calls[0][0] as { public_id: string }).public_id;
    expect(publicId).not.toContain("..");
    expect(publicId).not.toContain("/");
  });

  it("persists secure_url, never the insecure url", async () => {
    respondWith({
      secure_url: "https://res.cloudinary.com/axis-demo/image/upload/v1/x.png",
      url: "http://res.cloudinary.com/axis-demo/image/upload/v1/x.png",
      public_id: "axis-newsletter/content/x",
      bytes: 999,
    });

    const stored = await new CloudinaryMediaStore().put({
      originalName: "x.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });

    expect(stored.url).toBe("https://res.cloudinary.com/axis-demo/image/upload/v1/x.png");
    expect(stored.url.startsWith("https://")).toBe(true);
    expect(stored.url).not.toContain("http://");
  });

  it("refuses a response without a usable secure_url", async () => {
    respondWith({ url: "http://res.cloudinary.com/a/image/upload/v1/x.png" });
    await expect(
      new CloudinaryMediaStore().put({ originalName: "x.png", mimeType: "image/png", bytes: PNG_BYTES }),
    ).rejects.toBeInstanceOf(MediaUploadError);
  });

  it("fails with a friendly message when unconfigured, without uploading", async () => {
    setEnv({});
    await expect(
      new CloudinaryMediaStore().put({ originalName: "x.png", mimeType: "image/png", bytes: PNG_BYTES }),
    ).rejects.toThrow(/not configured/i);
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it("rejects a mime type outside the allow-list before uploading", async () => {
    await expect(
      new CloudinaryMediaStore().put({
        originalName: "x.svg",
        mimeType: "image/svg+xml",
        bytes: PNG_BYTES,
      }),
    ).rejects.toBeInstanceOf(MediaUploadError);
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ http_code: 401 }, "CLOUDINARY_AUTH_REJECTED"],
    [{ http_code: 420 }, "CLOUDINARY_RATE_LIMITED"],
    [{ http_code: 400 }, "CLOUDINARY_REJECTED_FILE"],
    [{ http_code: 500 }, "CLOUDINARY_SERVER_ERROR"],
    [{ message: "ETIMEDOUT" }, "CLOUDINARY_UNREACHABLE"],
  ])("classifies %j as %s", async (error, expectedCode) => {
    respondWith(null, error);
    try {
      await new CloudinaryMediaStore().put({
        originalName: "x.png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      });
      throw new Error("should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(MediaUploadError);
      expect((thrown as MediaUploadError).code).toBe(expectedCode);
    }
  });

  it("never leaks provider internals or the secret in an error message", async () => {
    respondWith(null, { http_code: 401, message: `signature failure for ${REAL_URL}` });
    try {
      await new CloudinaryMediaStore().put({
        originalName: "x.png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      });
    } catch (thrown) {
      const friendly = (thrown as MediaUploadError).friendlyMessage;
      expect(friendly).not.toContain("cloudinary://");
      expect(friendly).not.toContain("abcdefghijklmnopqrstuvwxyz1");
      expect(friendly).not.toContain("signature failure");
    }
  });
});

describe("Cloudinary store — historical asset safety", () => {
  it("does NOT destroy an asset on remove, so sent emails keep working", async () => {
    setEnv({ MEDIA_PROVIDER: "cloudinary", CLOUDINARY_URL: REAL_URL });
    const store = new CloudinaryMediaStore();
    await expect(store.remove()).resolves.toBeUndefined();
    // No destroy API is wired up at all.
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it("does not proxy asset bytes — Cloudinary serves its own images", async () => {
    expect(await new CloudinaryMediaStore().read()).toBeNull();
  });
});
