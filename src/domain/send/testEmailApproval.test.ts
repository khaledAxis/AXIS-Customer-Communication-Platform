import { describe, it, expect } from "vitest";

import {
  APPROVAL_REJECTION_MESSAGE,
  TEST_SUBJECT_PREFIX,
  applyTestSubjectPrefix,
  canonicalApprovalPayload,
  checkApproval,
  computeApprovalHash,
  type ApprovalSubjectMatter,
  type StoredApproval,
} from "./testEmailApproval";

const matter = (overrides: Partial<ApprovalSubjectMatter> = {}): ApprovalSubjectMatter => ({
  campaignId: "camp_1",
  subject: "[AXIS TEST] News",
  preheader: "Preview line",
  html: "<html>body</html>",
  text: "body",
  contentItemIds: ["a", "b", "c"],
  fromEmail: "axisgpscana@gmail.com",
  toEmail: "khaled-s@axis-gps.com",
  replyToEmail: "noreply@axis-gps.com",
  senderName: "AXIS Advanced Mapping Solutions",
  sendMode: "TEST",
  ...overrides,
});

describe("test subject marker", () => {
  it("adds the marker", () => {
    expect(applyTestSubjectPrefix("News")).toBe(`${TEST_SUBJECT_PREFIX} News`);
  });

  it("never double-prefixes, however many times it is applied", () => {
    const once = applyTestSubjectPrefix("News");
    expect(applyTestSubjectPrefix(once)).toBe(once);
    expect(applyTestSubjectPrefix(applyTestSubjectPrefix(once))).toBe(once);
  });

  it("keeps Hebrew subjects intact", () => {
    expect(applyTestSubjectPrefix("חדשות AXIS")).toBe(`${TEST_SUBJECT_PREFIX} חדשות AXIS`);
  });
});

describe("canonical payload and hashing", () => {
  it("is deterministic across calls", () => {
    expect(computeApprovalHash(matter())).toBe(computeApprovalHash(matter()));
  });

  it("produces a SHA-256 hex digest", () => {
    expect(computeApprovalHash(matter())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is insensitive to address case and padding", () => {
    expect(computeApprovalHash(matter({ toEmail: "  KHALED-S@AXIS-GPS.COM " }))).toBe(
      computeApprovalHash(matter()),
    );
  });

  it.each([
    ["subject", { subject: "[AXIS TEST] Different" }],
    ["preheader", { preheader: "Changed" }],
    ["html", { html: "<html>changed</html>" }],
    ["text", { text: "changed" }],
    ["content selection", { contentItemIds: ["a", "b"] }],
    ["content ORDER", { contentItemIds: ["c", "b", "a"] }],
    ["campaign", { campaignId: "camp_2" }],
    ["send mode", { sendMode: "PRODUCTION" }],
  ])("changes when the %s changes", (_label, override) => {
    expect(computeApprovalHash(matter(override as Partial<ApprovalSubjectMatter>))).not.toBe(
      computeApprovalHash(matter()),
    );
  });

  it("treats a null preheader and an empty one identically", () => {
    expect(computeApprovalHash(matter({ preheader: null }))).toBe(
      computeApprovalHash(matter({ preheader: "" })),
    );
  });

  it("cannot be spoofed by moving text across field boundaries", () => {
    // Length-prefixing means a value cannot imitate the next field's delimiter.
    const a = computeApprovalHash(matter({ subject: "A", text: "B" }));
    const b = computeApprovalHash(matter({ subject: "A\ntext:1:B", text: "" }));
    expect(a).not.toBe(b);
  });

  it("includes every field in the canonical payload", () => {
    const payload = canonicalApprovalPayload(matter());
    for (const key of [
      "campaignId",
      "sendMode",
      "fromEmail",
      "toEmail",
      "subject",
      "preheader",
      "contentItemIds",
      "html",
      "text",
    ]) {
      expect(payload).toContain(`${key}:`);
    }
  });
});

describe("reply-to is part of the approved message", () => {
  it("changes the hash when the reply address changes", () => {
    const before = computeApprovalHash(matter());
    const after = computeApprovalHash(matter({ replyToEmail: "other@axis-gps.com" }));
    expect(after).not.toBe(before);
  });

  it("changes the hash when the sender display name changes", () => {
    const before = computeApprovalHash(matter());
    const after = computeApprovalHash(matter({ senderName: "Someone Else" }));
    expect(after).not.toBe(before);
  });

  it("is insensitive to reply-address case, as addresses are", () => {
    expect(computeApprovalHash(matter({ replyToEmail: "NoReply@Axis-GPS.com" }))).toBe(
      computeApprovalHash(matter({ replyToEmail: "noreply@axis-gps.com" })),
    );
  });

  it("carries the reply address in the canonical payload", () => {
    expect(canonicalApprovalPayload(matter())).toContain("replyToEmail:");
    expect(canonicalApprovalPayload(matter())).toContain("noreply@axis-gps.com");
  });
});

describe("approval re-validation", () => {
  const hash = computeApprovalHash(matter());
  const expected = {
    fromEmail: "axisgpscana@gmail.com",
    toEmail: "khaled-s@axis-gps.com",
    replyToEmail: "noreply@axis-gps.com",
  };

  const stored = (overrides: Partial<StoredApproval> = {}): StoredApproval => ({
    id: "appr_1",
    contentHash: hash,
    fromEmail: "axisgpscana@gmail.com",
    toEmail: "khaled-s@axis-gps.com",
    replyToEmail: "noreply@axis-gps.com",
    sendMode: "TEST",
    consumedAt: null,
    revokedAt: null,
    ...overrides,
  });

  it("accepts an unused approval matching the current content", () => {
    expect(checkApproval(stored(), hash, expected)).toEqual({ valid: true });
  });

  it("rejects when there is no approval", () => {
    expect(checkApproval(null, hash, expected)).toMatchObject({ valid: false, reason: "NO_APPROVAL" });
  });

  it("rejects when the content changed after approval", () => {
    const changed = computeApprovalHash(matter({ subject: "[AXIS TEST] Edited" }));
    expect(checkApproval(stored(), changed, expected)).toMatchObject({
      valid: false,
      reason: "CONTENT_CHANGED",
    });
  });

  it("rejects an already-used approval", () => {
    expect(checkApproval(stored({ consumedAt: new Date() }), hash, expected)).toMatchObject({
      valid: false,
      reason: "ALREADY_USED",
    });
  });

  it("rejects a revoked approval", () => {
    expect(checkApproval(stored({ revokedAt: new Date() }), hash, expected)).toMatchObject({
      valid: false,
      reason: "REVOKED",
    });
  });

  it("rejects an approval taken against a different reply address", () => {
    // The configured NEWSLETTER_REPLY_TO changed after approval.
    expect(
      checkApproval(stored({ replyToEmail: "old-noreply@axis-gps.com" }), hash, expected),
    ).toMatchObject({ valid: false, reason: "WRONG_REPLY_TO" });
  });

  it("rejects an approval that predates reply-to being recorded", () => {
    expect(checkApproval(stored({ replyToEmail: null }), hash, expected)).toMatchObject({
      valid: false,
      reason: "WRONG_REPLY_TO",
    });
  });

  it("rejects a non-TEST approval", () => {
    expect(checkApproval(stored({ sendMode: "PRODUCTION" }), hash, expected)).toMatchObject({
      valid: false,
      reason: "NOT_TEST_MODE",
    });
  });

  it("rejects a mismatched sender or recipient", () => {
    expect(checkApproval(stored({ fromEmail: "other@axis-gps.com" }), hash, expected)).toMatchObject({
      valid: false,
      reason: "WRONG_SENDER",
    });
    expect(checkApproval(stored({ toEmail: "other@axis-gps.com" }), hash, expected)).toMatchObject({
      valid: false,
      reason: "WRONG_RECIPIENT",
    });
  });

  it("reports a content change ahead of prior use, so the user is told to re-approve", () => {
    const changed = computeApprovalHash(matter({ html: "<html>new</html>" }));
    expect(checkApproval(stored({ consumedAt: new Date() }), changed, expected)).toMatchObject({
      reason: "CONTENT_CHANGED",
    });
  });

  it("has a friendly message for every rejection reason", () => {
    for (const message of Object.values(APPROVAL_REJECTION_MESSAGE)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/hash|sha256|null|undefined|prisma/i);
    }
  });

  it("uses the exact wording required for a changed newsletter", () => {
    expect(APPROVAL_REJECTION_MESSAGE.CONTENT_CHANGED).toBe(
      "Newsletter changed after approval. Please review and approve again.",
    );
  });
});
