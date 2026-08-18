import { CloudinaryMediaStore } from "./cloudinaryMediaStore";
import { LocalMediaStore } from "./localMediaStore";
import type { MediaStore } from "./mediaStore";

/**
 * The single place that decides which MediaStore implementation is used.
 *
 * Selection is by `MEDIA_PROVIDER`, so no domain, service or UI code knows or cares
 * where an image is stored (ADR-0012 / ADR-0016).
 */

let store: MediaStore | undefined;
let override: MediaStore | undefined;

export function getMediaStore(): MediaStore {
  if (override) return override;
  if (!store) {
    const provider = (process.env.MEDIA_PROVIDER ?? "").trim().toLowerCase();
    store = provider === "cloudinary" ? new CloudinaryMediaStore() : new LocalMediaStore();
  }
  return store;
}

/**
 * Test seam. Injecting a fake keeps the suite entirely offline — no test can reach
 * Cloudinary even by accident.
 */
export function setMediaStoreForTesting(next: MediaStore | undefined): void {
  override = next;
  store = undefined;
}

export * from "./mediaStore";
