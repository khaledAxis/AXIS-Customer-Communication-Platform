import { randomBytes } from "node:crypto";

import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

import { ALLOWED_IMAGE_TYPES, type AllowedImageMime } from "../../domain/media/imagePolicy";
import {
  MediaUploadError,
  type MediaConfigStatus,
  type MediaStore,
  type PutMediaInput,
  type StoredMedia,
} from "./mediaStore";

/**
 * Cloudinary adapter — the ONLY code aware of the Cloudinary SDK (ADR-0016).
 *
 * Configured entirely from the server-side `CLOUDINARY_URL`, which embeds the API key
 * and secret and is therefore treated as a secret: never logged, never returned, never
 * placed in a client bundle, never persisted. Uploads are server-side and authenticated;
 * the browser never receives credentials or an upload signature.
 */

/** All assets live under one prefix so they are easy to find and manage. */
export const CLOUDINARY_FOLDER = "axis-newsletter/content";

/** cloudinary://<api_key>:<api_secret>@<cloud_name> */
const CLOUDINARY_URL_SHAPE = /^cloudinary:\/\/[^:]+:[^@]+@[^/\s]+$/;

interface CloudinaryConfig {
  cloudName: string;
}

/**
 * Validate configuration WITHOUT contacting Cloudinary.
 *
 * Only the cloud name is ever extracted for display — it is public (it appears in every
 * delivery URL). The key and secret are handed straight to the SDK and never surfaced.
 */
function readConfig(): { config?: CloudinaryConfig; problems: string[] } {
  const provider = (process.env.MEDIA_PROVIDER ?? "").trim().toLowerCase();
  const url = (process.env.CLOUDINARY_URL ?? "").trim();
  const problems: string[] = [];

  if (provider !== "cloudinary") {
    problems.push("MEDIA_PROVIDER must be cloudinary.");
  }
  if (url === "") {
    problems.push("CLOUDINARY_URL is not set.");
    return { problems };
  }
  if (!CLOUDINARY_URL_SHAPE.test(url)) {
    // Deliberately does not echo the value back.
    problems.push("CLOUDINARY_URL is not in the expected cloudinary://key:secret@cloud form.");
    return { problems };
  }

  const cloudName = url.slice(url.lastIndexOf("@") + 1);
  if (cloudName === "") {
    problems.push("CLOUDINARY_URL does not contain a cloud name.");
    return { problems };
  }

  if (problems.length > 0) return { problems };
  return { config: { cloudName }, problems: [] };
}

/** Map an SDK/API failure to a stable, sanitized classification. */
function classify(error: unknown): MediaUploadError {
  const shape = (error ?? {}) as { http_code?: number; name?: string; message?: string };
  const status = shape.http_code ?? 0;
  const message = typeof shape.message === "string" ? shape.message : "";

  if (status === 401 || status === 403 || /invalid signature|api_key/i.test(message)) {
    return new MediaUploadError(
      "CLOUDINARY_AUTH_REJECTED",
      "Image storage rejected the credentials. Please check the Cloudinary configuration.",
    );
  }
  if (status === 420 || status === 429) {
    return new MediaUploadError(
      "CLOUDINARY_RATE_LIMITED",
      "Image storage is busy right now. Please wait a moment and try again.",
    );
  }
  if (status === 400) {
    return new MediaUploadError(
      "CLOUDINARY_REJECTED_FILE",
      "Image storage could not accept that file. Please try a different picture.",
    );
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(message) || shape.name === "TimeoutError") {
    return new MediaUploadError(
      "CLOUDINARY_UNREACHABLE",
      "Could not reach image storage. Please check the connection and try again.",
    );
  }
  if (status >= 500) {
    return new MediaUploadError(
      "CLOUDINARY_SERVER_ERROR",
      "Image storage had a temporary problem. Please try again shortly.",
    );
  }
  return new MediaUploadError(
    "CLOUDINARY_UPLOAD_FAILED",
    "That image could not be uploaded. Please try again.",
  );
}

export class CloudinaryMediaStore implements MediaStore {
  readonly provider = "CLOUDINARY" as const;

  private configured = false;

  checkConfiguration(): MediaConfigStatus {
    const { config, problems } = readConfig();
    if (!config) {
      return {
        configured: false,
        problems,
        message: "Cloudinary image storage is not configured",
      };
    }
    return { configured: true, problems: [], message: "Cloudinary image storage ready" };
  }

  /** Initialise the SDK from CLOUDINARY_URL. Never logs or returns the value. */
  private ensureConfigured(): void {
    if (this.configured) return;
    const { config, problems } = readConfig();
    if (!config) {
      throw new MediaUploadError(
        "NOT_CONFIGURED",
        `Cloudinary image storage is not configured. ${problems.join(" ")}`.trim(),
      );
    }
    // The SDK reads CLOUDINARY_URL from the environment itself; passing secure ensures
    // every generated delivery URL is HTTPS.
    cloudinary.config({ secure: true });
    this.configured = true;
  }

  /**
   * Generated public id — the client filename is NEVER authoritative.
   *
   * A short readable slug aids humans browsing the Cloudinary console, but identity
   * comes from 16 random hex characters, so collisions and traversal are impossible.
   */
  private buildPublicId(originalName: string): string {
    const slug = originalName
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const token = randomBytes(8).toString("hex");
    return `${slug === "" ? "image" : slug}-${token}`;
  }

  async put(input: PutMediaInput): Promise<StoredMedia> {
    this.ensureConfigured();

    const extension = ALLOWED_IMAGE_TYPES[input.mimeType as AllowedImageMime];
    if (!extension) {
      throw new MediaUploadError("UNSUPPORTED_TYPE", "That image type is not supported.");
    }

    const publicId = this.buildPublicId(input.originalName);

    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: CLOUDINARY_FOLDER,
            public_id: publicId,
            resource_type: "image",
            overwrite: false,
            // No customer data and no secrets in provider metadata.
            tags: ["axis-newsletter", "content"],
          },
          (error, uploaded) => {
            if (error || !uploaded) reject(error ?? new Error("empty response"));
            else resolve(uploaded);
          },
        );
        stream.end(Buffer.from(input.bytes));
      });
    } catch (error) {
      throw classify(error);
    }

    // A malformed response must not become a broken image URL on the article.
    if (typeof result.secure_url !== "string" || !result.secure_url.startsWith("https://")) {
      throw new MediaUploadError(
        "CLOUDINARY_NO_SECURE_URL",
        "Image storage did not return a usable address for that picture.",
      );
    }

    return {
      filename: typeof result.public_id === "string" ? result.public_id : publicId,
      url: result.secure_url, // secure_url only — never the insecure http `url`
      mimeType: input.mimeType,
      byteLength: typeof result.bytes === "number" ? result.bytes : input.bytes.byteLength,
    };
  }

  /** Cloudinary serves its own assets; the app never proxies their bytes. */
  async read(): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    return null;
  }

  /**
   * Intentionally a NO-OP.
   *
   * Replacing an article image creates a NEW asset and repoints the ContentItem. The
   * old asset stays, because an already-sent email still references its delivery URL —
   * destroying it would break historical mail. Reclaiming genuinely unreferenced assets
   * is a separate, later maintenance task (ADR-0016).
   */
  async remove(): Promise<void> {
    return;
  }
}
