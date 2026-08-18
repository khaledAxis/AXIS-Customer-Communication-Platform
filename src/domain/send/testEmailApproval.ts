import { createHash } from "node:crypto";

/**
 * Approval identity for ONE exact test email (ADR-0013).
 *
 * An approval authorizes a specific rendered message, not "this campaign". The
 * canonical payload below covers everything that changes what the recipient would
 * see; at send time the newsletter is re-rendered, re-hashed, and compared. Any
 * difference invalidates the approval.
 *
 * `node:crypto` is stdlib and the hash is a pure function of its input — this keeps
 * `domain/` free of I/O and framework imports per CLAUDE.md.
 */

/** Visible marker on every real test message so it can never be mistaken for a live send. */
export const TEST_SUBJECT_PREFIX = "[AXIS TEST]";

/**
 * Apply the marker exactly once. Rendering the preview repeatedly, re-approving, or
 * re-sending must never produce "[AXIS TEST] [AXIS TEST] …".
 */
export function applyTestSubjectPrefix(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.startsWith(TEST_SUBJECT_PREFIX)) return trimmed;
  return `${TEST_SUBJECT_PREFIX} ${trimmed}`;
}

/** Everything that determines what the recipient would receive. */
export interface ApprovalSubjectMatter {
  campaignId: string;
  /** The FINAL subject, including the test prefix — exactly what is submitted. */
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  /** Ordered, included content item ids — reordering must invalidate an approval. */
  contentItemIds: string[];
  fromEmail: string;
  toEmail: string;
  sendMode: string;
}

/**
 * Deterministic canonical serialization.
 *
 * Field order is written explicitly rather than relying on object key order, and
 * nothing time-based or random is included, so the same message always produces the
 * same bytes on any machine and any run.
 */
export function canonicalApprovalPayload(matter: ApprovalSubjectMatter): string {
  const ordered: [string, string][] = [
    ["campaignId", matter.campaignId],
    ["sendMode", matter.sendMode],
    ["fromEmail", matter.fromEmail.trim().toLowerCase()],
    ["toEmail", matter.toEmail.trim().toLowerCase()],
    ["subject", matter.subject],
    ["preheader", matter.preheader ?? ""],
    ["contentItemIds", matter.contentItemIds.join(",")],
    ["html", matter.html],
    ["text", matter.text],
  ];

  // Length-prefixed so no field value can imitate a field boundary.
  return ordered.map(([key, value]) => `${key}:${value.length}:${value}`).join("\n");
}

export function computeApprovalHash(matter: ApprovalSubjectMatter): string {
  return createHash("sha256").update(canonicalApprovalPayload(matter), "utf8").digest("hex");
}

export type ApprovalRejection =
  | "NO_APPROVAL"
  | "CONTENT_CHANGED"
  | "ALREADY_USED"
  | "REVOKED"
  | "WRONG_SENDER"
  | "WRONG_RECIPIENT"
  | "NOT_TEST_MODE";

export interface StoredApproval {
  id: string;
  contentHash: string;
  fromEmail: string;
  toEmail: string;
  sendMode: string;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApprovalCheck {
  valid: boolean;
  reason?: ApprovalRejection;
}

/**
 * Pure re-validation of a stored approval against freshly rendered content.
 *
 * Order matters: "content changed" is reported before "already used" so a user who
 * edited the newsletter is told to re-approve rather than being told it was consumed.
 */
export function checkApproval(
  approval: StoredApproval | null,
  currentHash: string,
  expected: { fromEmail: string; toEmail: string },
): ApprovalCheck {
  if (!approval) return { valid: false, reason: "NO_APPROVAL" };
  if (approval.revokedAt !== null) return { valid: false, reason: "REVOKED" };
  if (approval.contentHash !== currentHash) return { valid: false, reason: "CONTENT_CHANGED" };
  if (approval.consumedAt !== null) return { valid: false, reason: "ALREADY_USED" };
  if (approval.sendMode !== "TEST") return { valid: false, reason: "NOT_TEST_MODE" };
  if (approval.fromEmail.toLowerCase() !== expected.fromEmail.toLowerCase()) {
    return { valid: false, reason: "WRONG_SENDER" };
  }
  if (approval.toEmail.toLowerCase() !== expected.toEmail.toLowerCase()) {
    return { valid: false, reason: "WRONG_RECIPIENT" };
  }
  return { valid: true };
}

/** Friendly, non-technical explanations for the UI. */
export const APPROVAL_REJECTION_MESSAGE: Record<ApprovalRejection, string> = {
  NO_APPROVAL: "Please approve this newsletter before sending a test email.",
  CONTENT_CHANGED: "Newsletter changed after approval. Please review and approve again.",
  ALREADY_USED: "That approval has already been used. Approve again to send another test.",
  REVOKED: "That approval is no longer valid. Please review and approve again.",
  WRONG_SENDER: "The approved sender does not match the authorised sender.",
  WRONG_RECIPIENT: "The approved recipient does not match the authorised recipient.",
  NOT_TEST_MODE: "Test sending is only available in test mode.",
};
