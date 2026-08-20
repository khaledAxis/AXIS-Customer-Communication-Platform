import { describe, it, expect } from "vitest";

import {
  checkProductionApproval,
  computeProductionApprovalHash,
  evaluateFourEyes,
  type ProductionApprovalSubjectMatter,
  type StoredProductionApproval,
} from "./productionApproval";

function matter(
  overrides: Partial<ProductionApprovalSubjectMatter> = {},
): ProductionApprovalSubjectMatter {
  return {
    campaignId: "c1",
    subject: "עדכון לקוחות",
    preheader: "מה חדש",
    html: "<html><body>hello</body></html>",
    text: "hello",
    contentItemIds: ["item-1", "item-2"],
    imageUrls: ["https://cdn.example.test/a.jpg"],
    campaignLanguage: "HE",
    senderEmail: "axisgpscana@gmail.com",
    senderName: "AXIS Advanced Mapping Solutions",
    replyToEmail: "noreply@axis-gps.com",
    finalAudienceId: "fa1",
    audienceHash: "audience-hash-1",
    ...overrides,
  };
}

function stored(
  overrides: Partial<StoredProductionApproval> = {},
): StoredProductionApproval {
  return {
    id: "ap1",
    contentHash: computeProductionApprovalHash(matter()),
    finalAudienceId: "fa1",
    audienceHash: "audience-hash-1",
    senderEmail: "axisgpscana@gmail.com",
    replyToEmail: "noreply@axis-gps.com",
    revokedAt: null,
    ...overrides,
  };
}

const current = {
  contentHash: computeProductionApprovalHash(matter()),
  finalAudienceId: "fa1" as string | null,
  audienceHash: "audience-hash-1" as string | null,
  senderEmail: "axisgpscana@gmail.com",
  replyToEmail: "noreply@axis-gps.com",
};

describe("production approval hash", () => {
  it("is deterministic", () => {
    expect(computeProductionApprovalHash(matter())).toBe(
      computeProductionApprovalHash(matter()),
    );
  });

  it.each([
    ["subject", { subject: "Something else" }],
    ["preheader", { preheader: "Different" }],
    ["html", { html: "<html><body>bye</body></html>" }],
    ["text", { text: "bye" }],
    ["content order", { contentItemIds: ["item-2", "item-1"] }],
    ["content selection", { contentItemIds: ["item-1"] }],
    ["image url", { imageUrls: ["https://cdn.example.test/b.jpg"] }],
    ["campaign language", { campaignLanguage: "AR" }],
    ["sender name", { senderName: "Someone Else" }],
    ["reply-to", { replyToEmail: "hello@axis-gps.com" }],
    ["final audience id", { finalAudienceId: "fa2" }],
    ["audience hash", { audienceHash: "audience-hash-2" }],
  ])("changes when the %s changes", (_label, override) => {
    expect(computeProductionApprovalHash(matter(override))).not.toBe(
      computeProductionApprovalHash(matter()),
    );
  });

  it("is case-insensitive for addresses, which mail servers are too", () => {
    expect(
      computeProductionApprovalHash(matter({ replyToEmail: "NoReply@Axis-GPS.com" })),
    ).toBe(computeProductionApprovalHash(matter()));
  });
});

describe("approval validity", () => {
  it("accepts an untouched approval", () => {
    expect(checkProductionApproval(stored(), current)).toEqual({ valid: true });
  });

  it("refuses a missing approval", () => {
    expect(checkProductionApproval(null, current)).toEqual({
      valid: false,
      reason: "NO_APPROVAL",
    });
  });

  it("refuses a withdrawn approval", () => {
    expect(
      checkProductionApproval(stored({ revokedAt: new Date() }), current),
    ).toEqual({ valid: false, reason: "REVOKED" });
  });

  it("refuses when the content changed", () => {
    expect(
      checkProductionApproval(stored({ contentHash: "other" }), current),
    ).toEqual({ valid: false, reason: "CONTENT_CHANGED" });
  });

  it("distinguishes a newer audience from a changed one", () => {
    // A second "Prepare final audience" produced a different snapshot row.
    expect(
      checkProductionApproval(stored({ finalAudienceId: "fa0" }), current),
    ).toEqual({ valid: false, reason: "AUDIENCE_REPLACED" });

    // Same snapshot row, but its recorded hash no longer matches.
    expect(
      checkProductionApproval(stored({ audienceHash: "older" }), current),
    ).toEqual({ valid: false, reason: "AUDIENCE_CHANGED" });
  });

  it("refuses when the audience was removed entirely", () => {
    expect(
      checkProductionApproval(stored(), {
        ...current,
        finalAudienceId: null,
        audienceHash: null,
      }),
    ).toEqual({ valid: false, reason: "AUDIENCE_REPLACED" });
  });

  it("refuses a changed sender or reply address", () => {
    expect(
      checkProductionApproval(stored({ senderEmail: "someone@else.test" }), current),
    ).toEqual({ valid: false, reason: "WRONG_SENDER" });

    expect(
      checkProductionApproval(stored({ replyToEmail: "hello@axis-gps.com" }), current),
    ).toEqual({ valid: false, reason: "WRONG_REPLY_TO" });
  });

  it("reports a content change before an audience change", () => {
    // A user who edited the newsletter should be told to re-approve the newsletter.
    expect(
      checkProductionApproval(
        stored({ contentHash: "other", audienceHash: "older" }),
        current,
      ),
    ).toEqual({ valid: false, reason: "CONTENT_CHANGED" });
  });
});

describe("four-eyes", () => {
  it("is BLOCKED while nobody can be identified", () => {
    expect(
      evaluateFourEyes({
        creatorId: "u1",
        approverId: "u2",
        approverRole: "MANAGER",
        authenticated: false,
      }),
    ).toEqual({ satisfied: false, reason: "NO_AUTHENTICATION" });
  });

  it("requires an approver", () => {
    expect(
      evaluateFourEyes({
        creatorId: "u1",
        approverId: null,
        approverRole: null,
        authenticated: true,
      }),
    ).toEqual({ satisfied: false, reason: "NO_APPROVER" });
  });

  it("requires a manager or administrator", () => {
    expect(
      evaluateFourEyes({
        creatorId: "u1",
        approverId: "u2",
        approverRole: null,
        authenticated: true,
      }),
    ).toEqual({ satisfied: false, reason: "NOT_A_MANAGER" });
  });

  it("refuses self-approval, including by an administrator", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      expect(
        evaluateFourEyes({
          creatorId: "u1",
          approverId: "u1",
          approverRole: role,
          authenticated: true,
        }),
      ).toEqual({ satisfied: false, reason: "SAME_PERSON" });
    }
  });

  it("is satisfied by a second signed-in manager", () => {
    expect(
      evaluateFourEyes({
        creatorId: "u1",
        approverId: "u2",
        approverRole: "MANAGER",
        authenticated: true,
      }),
    ).toEqual({ satisfied: true });
  });
});
