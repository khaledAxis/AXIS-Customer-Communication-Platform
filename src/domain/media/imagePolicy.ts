/**
 * Newsletter image upload policy (pure rules — no filesystem access).
 *
 * Defence in depth, because an uploaded file is untrusted input:
 *  1. extension allow-list          (never a deny-list)
 *  2. declared MIME allow-list
 *  3. magic-byte sniffing           — the bytes must actually BE the claimed type,
 *                                     so renaming evil.html to photo.png is caught
 *  4. size ceiling
 *  5. generated storage filename    — the client name never reaches the filesystem,
 *                                     so path traversal is structurally impossible
 *
 * SVG is REJECTED in v1: it is an XML document that can carry script, and no
 * sanitizer is in place (ADR-0012).
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — ample for newsletter imagery

export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type AllowedImageMime = keyof typeof ALLOWED_IMAGE_TYPES;

export type ImageRejectionReason =
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "SVG_NOT_ALLOWED"
  | "CONTENT_DOES_NOT_MATCH_TYPE";

export interface ImageRejection {
  ok: false;
  reason: ImageRejectionReason;
  message: string;
}

export interface ImageAcceptance {
  ok: true;
  mimeType: AllowedImageMime;
  extension: string;
}

export type ImageValidationResult = ImageAcceptance | ImageRejection;

const MESSAGES: Record<ImageRejectionReason, string> = {
  EMPTY_FILE: "That file is empty. Please choose an image.",
  TOO_LARGE: `That image is too large. The maximum size is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
  UNSUPPORTED_TYPE: "Please use a JPG, PNG, WebP or GIF image.",
  SVG_NOT_ALLOWED: "SVG images are not supported. Please upload a JPG, PNG, WebP or GIF.",
  CONTENT_DOES_NOT_MATCH_TYPE:
    "That file does not look like a real image. Please upload a valid JPG, PNG, WebP or GIF.",
};

function reject(reason: ImageRejectionReason): ImageRejection {
  return { ok: false, reason, message: MESSAGES[reason] };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Identify an image from its leading bytes. Returns null when the content is not a
 * supported raster image — including when it is really HTML, a script, or an SVG.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"; // GIF8
  // WebP = "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export interface ImageUploadCandidate {
  filename: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}

export function validateImageUpload(candidate: ImageUploadCandidate): ImageValidationResult {
  const { filename, declaredMimeType, bytes } = candidate;

  if (bytes.length === 0) return reject("EMPTY_FILE");
  if (bytes.length > MAX_IMAGE_BYTES) return reject("TOO_LARGE");

  const declared = declaredMimeType.split(";")[0].trim().toLowerCase();
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";

  if (declared === "image/svg+xml" || extension === "svg") return reject("SVG_NOT_ALLOWED");

  if (!(declared in ALLOWED_IMAGE_TYPES)) return reject("UNSUPPORTED_TYPE");

  const allowedExtension = ALLOWED_IMAGE_TYPES[declared as AllowedImageMime];
  const extensionMatches =
    extension === allowedExtension || (declared === "image/jpeg" && extension === "jpeg");
  if (!extensionMatches) return reject("UNSUPPORTED_TYPE");

  // The bytes must genuinely be the declared type.
  const sniffed = sniffImageMime(bytes);
  if (sniffed === null || sniffed !== declared) return reject("CONTENT_DOES_NOT_MATCH_TYPE");

  return { ok: true, mimeType: declared as AllowedImageMime, extension: allowedExtension };
}

/**
 * Build the on-disk name. The client-supplied filename is NEVER used as a path —
 * only a short slug of it is kept for readability, with the identity coming from a
 * caller-supplied random token. Traversal (`../`), absolute paths, NTFS streams and
 * unicode tricks cannot survive this.
 */
export function buildStoredFilename(originalName: string, token: string, extension: string): string {
  const base = originalName
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const safeToken = token.replace(/[^a-z0-9]/gi, "").slice(0, 32);
  const slug = base === "" ? "image" : base;
  return `${slug}-${safeToken}.${extension}`;
}

/** Storage names this application generates. Anything else must be refused. */
export const STORED_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}\.(jpg|png|webp|gif)$/;

export function isValidStoredFilename(name: string): boolean {
  return STORED_FILENAME_PATTERN.test(name);
}
