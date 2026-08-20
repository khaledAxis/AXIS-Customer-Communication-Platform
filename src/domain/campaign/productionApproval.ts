import { createHash } from "node:crypto";

/**
 * Approval identity for ONE exact production newsletter (ADR-0022).
 *
 * This is the same philosophy as the SAFE TEST approval (ADR-0013), extended with the
 * audience: an approval authorizes a specific rendered message sent to a specific
 * frozen set of people, not "this campaign". The canonical payload below covers
 * everything that changes what a recipient would see AND who the recipients are; at
 * readiness time the newsletter is re-rendered, the audience is re-resolved, both are
 * re-hashed, and any difference invalidates the approval.
 *
 * Nothing here sends anything, and nothing here can enable sending. It answers one
 * question: has THIS exact newsletter, to THIS exact audience, been approved?
 *
 * `node:crypto` is stdlib and the hash is a pure function of its input — `domain/`
 * stays free of I/O and framework imports per CLAUDE.md.
 */

/** Everything that determines what is sent, and to whom. */
export interface ProductionApprovalSubjectMatter {
  campaignId: string;
  /** The final subject line, exactly as it would be submitted. */
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  /** Ordered, included content item ids — reordering must invalidate an approval. */
  contentItemIds: string[];
  /**
   * Image URLs in delivery order. The HTML already contains them, but listing them
   * separately means a swapped image is legible in the payload rather than buried in
   * a diff of two large documents.
   */
  imageUrls: string[];
  /** The campaign's language — RTL rendering and audience language both depend on it. */
  campaignLanguage: string;
  senderEmail: string;
  senderName: string;
  replyToEmail: string;
  /** Identity of the frozen audience this approval is bound to. */
  finalAudienceId: string;
  audienceHash: string;
}

/**
 * Deterministic canonical serialization.
 *
 * Field order is written explicitly rather than relying on object key order, and
 * nothing time-based or random is included, so the same message always produces the
 * same bytes on any machine and any run.
 */
export function canonicalProductionApprovalPayload(
  matter: ProductionApprovalSubjectMatter,
): string {
  const ordered: [string, string][] = [
    ["campaignId", matter.campaignId],
    ["campaignLanguage", matter.campaignLanguage],
    ["senderEmail", matter.senderEmail.trim().toLowerCase()],
    ["senderName", matter.senderName],
    ["replyToEmail", matter.replyToEmail.trim().toLowerCase()],
    ["subject", matter.subject],
    ["preheader", matter.preheader ?? ""],
    ["contentItemIds", matter.contentItemIds.join(",")],
    ["imageUrls", matter.imageUrls.join(",")],
    ["html", matter.html],
    ["text", matter.text],
    ["finalAudienceId", matter.finalAudienceId],
    ["audienceHash", matter.audienceHash],
  ];

  // Length-prefixed so no field value can imitate a field boundary.
  return ordered.map(([key, value]) => `${key}:${value.length}:${value}`).join("\n");
}

export function computeProductionApprovalHash(
  matter: ProductionApprovalSubjectMatter,
): string {
  return createHash("sha256")
    .update(canonicalProductionApprovalPayload(matter), "utf8")
    .digest("hex");
}

export type ProductionApprovalRejection =
  | "NO_APPROVAL"
  | "REVOKED"
  | "CONTENT_CHANGED"
  | "AUDIENCE_REPLACED"
  | "AUDIENCE_CHANGED"
  | "WRONG_SENDER"
  | "WRONG_REPLY_TO";

export const PRODUCTION_APPROVAL_MESSAGE: Record<ProductionApprovalRejection, string> = {
  NO_APPROVAL: "This newsletter has not been approved for production yet.",
  REVOKED: "That approval was withdrawn. Review and approve again.",
  CONTENT_CHANGED:
    "Newsletter changed after approval. Please review and approve again.",
  AUDIENCE_REPLACED:
    "A newer final audience was prepared after this approval. Review and approve again.",
  AUDIENCE_CHANGED:
    "The audience changed after approval. Prepare the final audience and approve again.",
  WRONG_SENDER: "The approved sender no longer matches the configured sender.",
  WRONG_REPLY_TO:
    "The reply address changed after approval. Please review and approve again.",
};

export interface StoredProductionApproval {
  id: string;
  contentHash: string;
  finalAudienceId: string;
  audienceHash: string;
  senderEmail: string;
  replyToEmail: string;
  revokedAt: Date | null;
}

export interface ProductionApprovalCheck {
  valid: boolean;
  reason?: ProductionApprovalRejection;
}

/**
 * Pure re-validation of a stored approval against freshly rendered content and a
 * freshly resolved audience.
 *
 * Order matters: the audience checks come after the content check so a user who
 * edited the newsletter is told to re-approve the newsletter, and the two audience
 * failures are distinguished — "someone prepared a newer audience" and "the people in
 * the approved audience changed" call for different explanations even though both
 * end the same way.
 */
export function checkProductionApproval(
  approval: StoredProductionApproval | null,
  current: {
    contentHash: string;
    finalAudienceId: string | null;
    audienceHash: string | null;
    senderEmail: string;
    replyToEmail: string;
  },
): ProductionApprovalCheck {
  if (!approval) return { valid: false, reason: "NO_APPROVAL" };
  if (approval.revokedAt !== null) return { valid: false, reason: "REVOKED" };
  if (approval.contentHash !== current.contentHash) {
    return { valid: false, reason: "CONTENT_CHANGED" };
  }
  if (approval.finalAudienceId !== current.finalAudienceId) {
    return { valid: false, reason: "AUDIENCE_REPLACED" };
  }
  if (approval.audienceHash !== current.audienceHash) {
    return { valid: false, reason: "AUDIENCE_CHANGED" };
  }
  if (approval.senderEmail.toLowerCase() !== current.senderEmail.trim().toLowerCase()) {
    return { valid: false, reason: "WRONG_SENDER" };
  }
  if (
    approval.replyToEmail.toLowerCase() !== current.replyToEmail.trim().toLowerCase()
  ) {
    return { valid: false, reason: "WRONG_REPLY_TO" };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Four-eyes
// ---------------------------------------------------------------------------

export type FourEyesVerdict =
  | { satisfied: true }
  | { satisfied: false; reason: FourEyesProblem };

export type FourEyesProblem =
  | "NO_AUTHENTICATION"
  | "SAME_PERSON"
  | "NOT_A_MANAGER"
  | "NO_APPROVER";

export const FOUR_EYES_MESSAGE: Record<FourEyesProblem, string> = {
  NO_AUTHENTICATION:
    "Nobody is signed in. Real sign-in must exist before a production approval can identify who approved.",
  SAME_PERSON:
    "The person who prepared this newsletter cannot also approve it. Ask a second manager.",
  NOT_A_MANAGER: "Only a manager or administrator can approve a newsletter.",
  NO_APPROVER: "This newsletter has not been approved by a second person yet.",
};

export interface FourEyesInput {
  creatorId: string;
  approverId: string | null;
  approverRole: "ADMIN" | "MANAGER" | null;
  /**
   * Whether the approver is a really-authenticated user.
   *
   * This platform currently attributes every action to one local development actor
   * (there is no sign-in yet), so it cannot tell two employees apart. Four-eyes is
   * therefore reported as BLOCKED rather than quietly passing — inventing a second
   * identity would make the check look satisfied while proving nothing.
   */
  authenticated: boolean;
}

export function evaluateFourEyes(input: FourEyesInput): FourEyesVerdict {
  if (!input.authenticated) {
    return { satisfied: false, reason: "NO_AUTHENTICATION" };
  }
  if (!input.approverId) return { satisfied: false, reason: "NO_APPROVER" };
  if (input.approverRole !== "ADMIN" && input.approverRole !== "MANAGER") {
    return { satisfied: false, reason: "NOT_A_MANAGER" };
  }
  // ADMIN is not exempt here. The exemption in the campaign state machine covers an
  // administrator unblocking a stuck workflow; a production customer send is exactly
  // the case where a second pair of eyes is worth the friction.
  if (input.approverId === input.creatorId) {
    return { satisfied: false, reason: "SAME_PERSON" };
  }
  return { satisfied: true };
}
