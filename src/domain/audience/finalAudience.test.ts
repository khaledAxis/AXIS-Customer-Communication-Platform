import { describe, it, expect } from "vitest";

import {
  computeAudienceHash,
  evaluateStaleness,
  stableJson,
  type FinalAudienceSubjectMatter,
  type FinalDestination,
  type FinalExclusion,
} from "./finalAudience";
import {
  ConsentStatus,
  EmailStatus,
  ExclusionReason,
  Language,
} from "../types";

function destination(
  overrides: Partial<FinalDestination> = {},
): FinalDestination {
  return {
    normalizedEmail: "a@example.test",
    intendedEmail: "A@example.test",
    language: Language.HE,
    consentStatus: ConsentStatus.GRANTED,
    emailStatus: EmailStatus.VALID,
    sources: [
      {
        sourceBoardId: "board-1",
        sourceItemId: "item-1",
        sourceEntityType: "CUSTOMERS",
        emailSourceType: "COMPANY_EMAIL",
        sourceEmailRaw: "A@example.test",
        label: "ABC Surveying",
        companyName: null,
      },
    ],
    ...overrides,
  };
}

function exclusion(overrides: Partial<FinalExclusion> = {}): FinalExclusion {
  return {
    sourceBoardId: "board-1",
    sourceItemId: "item-9",
    sourceEntityType: "CONTACTS",
    emailSourceType: "CONTACT_EMAIL",
    sourceEmailRaw: "gone@example.test",
    normalizedEmail: "gone@example.test",
    reason: ExclusionReason.UNSUBSCRIBED,
    label: "Jane Doe",
    ...overrides,
  };
}

function matter(
  overrides: Partial<FinalAudienceSubjectMatter> = {},
): FinalAudienceSubjectMatter {
  return {
    campaignId: "c1",
    segmentId: "s1",
    segmentCriteria: { version: 1, conditions: [], groups: [] },
    campaignLanguage: Language.HE,
    requireLanguage: Language.HE,
    requireExplicitConsent: false,
    destinations: [destination()],
    exclusions: [exclusion()],
    ...overrides,
  };
}

describe("stable JSON", () => {
  it("orders object keys at every depth", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("keeps array order, which is meaningful", () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
});

describe("final audience hash", () => {
  it("is deterministic for the same audience", () => {
    expect(computeAudienceHash(matter())).toBe(computeAudienceHash(matter()));
  });

  it("ignores the order rows came back from the database in", () => {
    const a = destination({ normalizedEmail: "a@example.test" });
    const b = destination({ normalizedEmail: "b@example.test" });
    expect(computeAudienceHash(matter({ destinations: [a, b] }))).toBe(
      computeAudienceHash(matter({ destinations: [b, a] })),
    );
  });

  it("changes when a destination is added", () => {
    const bigger = matter({
      destinations: [destination(), destination({ normalizedEmail: "b@example.test" })],
    });
    expect(computeAudienceHash(bigger)).not.toBe(computeAudienceHash(matter()));
  });

  it("changes when a destination's language changes", () => {
    expect(
      computeAudienceHash(
        matter({ destinations: [destination({ language: Language.AR })] }),
      ),
    ).not.toBe(computeAudienceHash(matter()));
  });

  it("changes when a destination's consent changes", () => {
    expect(
      computeAudienceHash(
        matter({
          destinations: [destination({ consentStatus: ConsentStatus.UNKNOWN })],
        }),
      ),
    ).not.toBe(computeAudienceHash(matter()));
  });

  it("changes when an exclusion reason changes", () => {
    expect(
      computeAudienceHash(
        matter({
          exclusions: [exclusion({ reason: ExclusionReason.SUPPRESSED })],
        }),
      ),
    ).not.toBe(computeAudienceHash(matter()));
  });

  it("changes when the CRM record behind a destination changes", () => {
    const moved = destination({
      sources: [
        {
          ...destination().sources[0],
          sourceItemId: "item-2",
        },
      ],
    });
    expect(computeAudienceHash(matter({ destinations: [moved] }))).not.toBe(
      computeAudienceHash(matter()),
    );
  });

  it("changes when the segment rules change", () => {
    expect(
      computeAudienceHash(
        matter({ segmentCriteria: { version: 1, conditions: [{ f: 1 }], groups: [] } }),
      ),
    ).not.toBe(computeAudienceHash(matter()));
  });

  it("changes when the campaign language changes", () => {
    expect(
      computeAudienceHash(
        matter({ campaignLanguage: Language.AR, requireLanguage: Language.AR }),
      ),
    ).not.toBe(computeAudienceHash(matter()));
  });

  it("does NOT change when a company is renamed in Monday", () => {
    // The same people still receive the same email; a display name is not identity.
    const renamed = destination({
      sources: [{ ...destination().sources[0], label: "ABC Surveying Ltd." }],
    });
    expect(computeAudienceHash(matter({ destinations: [renamed] }))).toBe(
      computeAudienceHash(matter()),
    );
  });

  it("cannot be confused by a value that imitates a field boundary", () => {
    const sneaky = matter({
      destinations: [
        destination({ normalizedEmail: "x@example.test\nexclusions:0:" }),
      ],
    });
    expect(computeAudienceHash(sneaky)).not.toBe(computeAudienceHash(matter()));
  });
});

describe("staleness", () => {
  const base = {
    audienceHash: "hash-1",
    segmentId: "s1",
    segmentCriteria: stableJson({ a: 1 }),
    campaignLanguage: Language.HE,
  };

  it("is fresh when nothing moved", () => {
    expect(evaluateStaleness({ frozen: base, current: { ...base } })).toEqual({
      stale: false,
    });
  });

  it("reports a replaced segment before anything else", () => {
    const verdict = evaluateStaleness({
      frozen: base,
      current: { ...base, segmentId: "s2", audienceHash: "hash-2" },
    });
    expect(verdict).toEqual({ stale: true, reason: "SEGMENT_REMOVED" });
  });

  it("reports edited segment rules by name", () => {
    const verdict = evaluateStaleness({
      frozen: base,
      current: { ...base, segmentCriteria: stableJson({ a: 2 }) },
    });
    expect(verdict).toEqual({ stale: true, reason: "SEGMENT_CHANGED" });
  });

  it("reports a changed campaign language by name", () => {
    const verdict = evaluateStaleness({
      frozen: base,
      current: { ...base, campaignLanguage: Language.AR },
    });
    expect(verdict).toEqual({ stale: true, reason: "CAMPAIGN_LANGUAGE_CHANGED" });
  });

  it("reports a changed audience when only the people moved", () => {
    const verdict = evaluateStaleness({
      frozen: base,
      current: { ...base, audienceHash: "hash-2" },
    });
    expect(verdict).toEqual({ stale: true, reason: "AUDIENCE_CHANGED" });
  });
});
