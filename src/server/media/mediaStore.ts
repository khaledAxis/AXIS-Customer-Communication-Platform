/**
 * MediaStore port (ADR-0012).
 *
 * The content domain and services depend on THIS interface only — never on a
 * filesystem or a cloud SDK. Swapping local development storage for production
 * object storage (S3/Azure Blob) means adding one implementation and changing one
 * factory line; no domain, service, or UI code changes.
 *
 * Binary image data is deliberately NOT stored in PostgreSQL.
 */

export interface StoredMedia {
  /** Generated storage filename — never a client-supplied path. */
  filename: string;
  /** Application URL the newsletter/UI references. */
  url: string;
  mimeType: string;
  byteLength: number;
}

export interface PutMediaInput {
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MediaStore {
  put(input: PutMediaInput): Promise<StoredMedia>;
  read(filename: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  remove(filename: string): Promise<void>;
}

/** Public URL for a stored object. Kept here so every caller agrees on the shape. */
export function mediaUrlFor(filename: string): string {
  return `/api/media/${filename}`;
}
