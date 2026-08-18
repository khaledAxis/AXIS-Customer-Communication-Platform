/**
 * MediaStore port (ADR-0012, extended for hosted storage by ADR-0016).
 *
 * The content domain, services and UI depend on THIS interface only — never on a
 * filesystem or a cloud SDK. Swapping local development storage for hosted object
 * storage means adding one implementation and changing one factory line.
 *
 * Binary image data is deliberately NOT stored in PostgreSQL, and provider
 * credentials never leave the server.
 */

export type MediaProviderName = "LOCAL" | "CLOUDINARY";

export interface StoredMedia {
  /** Generated storage identifier — never a client-supplied path. */
  filename: string;
  /**
   * URL persisted on the ContentItem and referenced by the newsletter.
   * For hosted providers this is an absolute HTTPS delivery URL; for local
   * development storage it is an app-relative media route.
   */
  url: string;
  mimeType: string;
  byteLength: number;
}

export interface PutMediaInput {
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MediaConfigStatus {
  configured: boolean;
  /** Sanitized reasons the provider cannot be used — never contains secret values. */
  problems: string[];
  /** Friendly, non-technical status for the UI. */
  message: string;
}

export interface MediaStore {
  readonly provider: MediaProviderName;
  /** Cheap, local check — must never call the provider's API or upload anything. */
  checkConfiguration(): MediaConfigStatus;
  put(input: PutMediaInput): Promise<StoredMedia>;
  read(filename: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  /**
   * Release a stored object.
   *
   * Hosted implementations may deliberately make this a no-op: a previously sent
   * email still references the delivery URL, so destroying the asset would break
   * historical mail (ADR-0016).
   */
  remove(filename: string): Promise<void>;
}

/** App-relative URL for a locally stored object. */
export function mediaUrlFor(filename: string): string {
  return `/api/media/${filename}`;
}

/** Raised when an upload fails; carries a friendly message, never provider internals. */
export class MediaUploadError extends Error {
  readonly friendlyMessage: string;
  readonly code: string;

  constructor(code: string, friendlyMessage: string) {
    super(`${code}: ${friendlyMessage}`);
    this.name = "MediaUploadError";
    this.code = code;
    this.friendlyMessage = friendlyMessage;
  }
}
