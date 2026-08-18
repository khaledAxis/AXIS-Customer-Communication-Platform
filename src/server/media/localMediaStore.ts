import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ALLOWED_IMAGE_TYPES,
  buildStoredFilename,
  isValidStoredFilename,
  type AllowedImageMime,
} from "../../domain/media/imagePolicy";
import {
  mediaUrlFor,
  type MediaConfigStatus,
  type MediaStore,
  type PutMediaInput,
  type StoredMedia,
} from "./mediaStore";

/**
 * LOCAL DEVELOPMENT media store — writes to a git-ignored directory outside `public/`.
 *
 * Files are intentionally NOT placed in `public/`: they are served by a route handler
 * that re-validates the filename and forces a safe content type, so an uploaded file
 * can never be served as HTML/JS or executed. Replace with object storage in production
 * (this is the only file that touches the filesystem).
 */

const MEDIA_ROOT = path.resolve(process.cwd(), "var", "media");

function resolveWithinRoot(filename: string): string {
  // Structural traversal defence: only names this app generated are accepted, and the
  // resolved path must still sit inside the media root.
  if (!isValidStoredFilename(filename)) {
    throw new Error("Invalid media filename.");
  }
  const resolved = path.resolve(MEDIA_ROOT, filename);
  const root = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error("Invalid media path.");
  }
  return resolved;
}

function mimeForExtension(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const entry = (Object.entries(ALLOWED_IMAGE_TYPES) as [AllowedImageMime, string][]).find(
    ([, allowedExt]) => allowedExt === ext,
  );
  return entry ? entry[0] : "application/octet-stream";
}

export class LocalMediaStore implements MediaStore {
  readonly provider = "LOCAL" as const;

  /**
   * Always "configured" — it is the filesystem. The message is deliberately honest:
   * images stored here cannot be loaded by an email recipient.
   */
  checkConfiguration(): MediaConfigStatus {
    return {
      configured: true,
      problems: [],
      message: "Local development image storage (pictures will not appear in email)",
    };
  }

  async put(input: PutMediaInput): Promise<StoredMedia> {
    const extension = ALLOWED_IMAGE_TYPES[input.mimeType as AllowedImageMime];
    if (!extension) throw new Error("Unsupported media type.");

    const filename = buildStoredFilename(input.originalName, randomBytes(8).toString("hex"), extension);
    const target = resolveWithinRoot(filename);

    await mkdir(MEDIA_ROOT, { recursive: true });
    await writeFile(target, input.bytes);

    return {
      filename,
      url: mediaUrlFor(filename),
      mimeType: input.mimeType,
      byteLength: input.bytes.byteLength,
    };
  }

  async read(filename: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    let target: string;
    try {
      target = resolveWithinRoot(filename);
    } catch {
      return null; // invalid name — treated as "not found", never an error path
    }
    try {
      // turbopackIgnore: the path is already constrained to MEDIA_ROOT by
      // resolveWithinRoot(); without this the bundler traces the whole project.
      const bytes = await readFile(/* turbopackIgnore: true */ target);
      return { bytes: new Uint8Array(bytes), mimeType: mimeForExtension(filename) };
    } catch {
      return null;
    }
  }

  async remove(filename: string): Promise<void> {
    try {
      await unlink(resolveWithinRoot(filename));
    } catch {
      // Already gone (or never valid) — removal is idempotent.
    }
  }
}

export { MEDIA_ROOT };
