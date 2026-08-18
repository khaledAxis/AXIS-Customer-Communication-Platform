import { validateImageUpload, type ImageRejectionReason } from "../../domain/media/imagePolicy";
import { getMediaStore } from "../media/localMediaStore";
import type { StoredMedia } from "../media/mediaStore";

/**
 * Image upload use-case.
 *
 * Validation is pure domain logic; storage is behind the MediaStore port. Nothing
 * here knows whether the bytes land on local disk or in object storage.
 */

export type UploadResult =
  | { ok: true; media: StoredMedia }
  | { ok: false; reason: ImageRejectionReason; message: string };

export async function uploadNewsletterImage(file: {
  name: string;
  type: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  const validation = validateImageUpload({
    filename: file.name,
    declaredMimeType: file.type,
    bytes: file.bytes,
  });

  if (!validation.ok) {
    return { ok: false, reason: validation.reason, message: validation.message };
  }

  const media = await getMediaStore().put({
    originalName: file.name,
    mimeType: validation.mimeType,
    bytes: file.bytes,
  });

  return { ok: true, media };
}

export async function readMedia(filename: string) {
  return getMediaStore().read(filename);
}

export async function removeMedia(filename: string) {
  return getMediaStore().remove(filename);
}
