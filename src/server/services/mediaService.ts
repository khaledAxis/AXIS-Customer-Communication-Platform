import { validateImageUpload, type ImageRejectionReason } from "../../domain/media/imagePolicy";
import { Capability, requireCapability } from "../auth/session";
import { getMediaStore } from "../media";
import { MediaUploadError, type MediaConfigStatus, type StoredMedia } from "../media/mediaStore";

/**
 * Image upload use-case.
 *
 * Validation is pure domain logic and runs BEFORE any provider call; storage is behind
 * the MediaStore port. Nothing here knows whether the bytes land on local disk or in
 * hosted object storage.
 *
 * A failed upload never yields a URL, so the caller keeps the article's existing image
 * rather than saving a broken one.
 */

export type UploadFailureReason = ImageRejectionReason | "UPLOAD_FAILED";

export type UploadResult =
  | { ok: true; media: StoredMedia }
  | { ok: false; reason: UploadFailureReason; code?: string; message: string };

export async function uploadNewsletterImage(file: {
  name: string;
  type: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  // Uploading writes to shared storage referenced by sent newsletters.
  await requireCapability(Capability.MANAGE_CONTENT);
  // Local validation is mandatory and is NEVER delegated to the storage provider:
  // magic-byte sniffing, type allow-list, size ceiling and SVG rejection all run here.
  const validation = validateImageUpload({
    filename: file.name,
    declaredMimeType: file.type,
    bytes: file.bytes,
  });

  if (!validation.ok) {
    return { ok: false, reason: validation.reason, message: validation.message };
  }

  try {
    const media = await getMediaStore().put({
      originalName: file.name,
      mimeType: validation.mimeType,
      bytes: file.bytes,
    });
    return { ok: true, media };
  } catch (error) {
    if (error instanceof MediaUploadError) {
      // Friendly text only — provider internals and credentials never reach the user.
      return { ok: false, reason: "UPLOAD_FAILED", code: error.code, message: error.friendlyMessage };
    }
    return {
      ok: false,
      reason: "UPLOAD_FAILED",
      code: "UNKNOWN",
      message: "That image could not be uploaded. Please try again.",
    };
  }
}

/** Provider readiness for the UI. Never uploads anything and never reveals a secret. */
export function checkMediaConfiguration(): MediaConfigStatus & { provider: string } {
  const store = getMediaStore();
  return { ...store.checkConfiguration(), provider: store.provider };
}

export async function readMedia(filename: string) {
  return getMediaStore().read(filename);
}

export async function removeMedia(filename: string) {
  return getMediaStore().remove(filename);
}
