import { CrmBoardKind } from "../types";
import { normalizeEmail } from "../email/normalizeEmail";

/**
 * Pure mapper: raw Monday contact item -> the Monday-owned Contact projection.
 *
 * This encodes the ownership boundary (ADR-0009 §1/§2): the projection contains
 * ONLY Monday-owned + system fields. It structurally CANNOT carry
 * `emailStatus`/`language`/`consentStatus` — those live on `CommunicationAddress`
 * and are never written by a sync. Tests assert this separation.
 */

export interface RawMondayContact {
  boardId: string;
  itemId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  address?: string | null;
}

export interface ContactProjection {
  mondayBoardId: string;
  mondayItemId: string;
  source: "MONDAY";
  sourceEntityType: CrmBoardKind;
  fullName: string | null;
  email: string | null;
  emailNorm: string | null;
  phone: string | null;
  jobTitle: string | null;
  address: string | null;
}

/** The exact set of keys a sync may write for a Contact (no communication state). */
export const MONDAY_OWNED_CONTACT_KEYS = [
  "mondayBoardId",
  "mondayItemId",
  "source",
  "sourceEntityType",
  "fullName",
  "email",
  "emailNorm",
  "phone",
  "jobTitle",
  "address",
] as const;

export function toContactProjection(raw: RawMondayContact): ContactProjection {
  const norm = normalizeEmail(raw.email);
  return {
    mondayBoardId: raw.boardId,
    mondayItemId: raw.itemId,
    source: "MONDAY",
    sourceEntityType: CrmBoardKind.CONTACTS,
    fullName: raw.fullName ?? null,
    email: raw.email ?? null,
    emailNorm: norm.kind === "valid" ? norm.normalized : null,
    phone: raw.phone ?? null,
    jobTitle: raw.jobTitle ?? null,
    address: raw.address ?? null,
  };
}
