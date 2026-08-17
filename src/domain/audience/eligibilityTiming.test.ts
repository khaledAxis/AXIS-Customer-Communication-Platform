import { describe, it, expect } from "vitest";
import { resolveAudience, AudienceCandidate } from "./resolveAudience";
import { ConsentStatus, CrmBoardKind, EmailSourceType, EmailStatus, Language } from "../types";

/**
 * Audience is re-resolved at SEND time from live communication state, so a
 * customer who unsubscribes/gets suppressed between newsletter preparation and
 * the scheduled send is excluded from that send (ADR-0009 §19).
 */
function candidate(over: Partial<AudienceCandidate["address"]> = {}): AudienceCandidate {
  return {
    sourceBoardId: CrmBoardKind.CONTACTS === "CONTACTS" ? "1903020916" : "",
    sourceItemId: "1",
    sourceEntityType: CrmBoardKind.CONTACTS,
    emailSourceType: EmailSourceType.CONTACT_EMAIL,
    rawEmail: "person@axis.com",
    address: {
      emailStatus: EmailStatus.VALID,
      language: Language.UNKNOWN,
      consentStatus: ConsentStatus.UNKNOWN,
      isUnsubscribed: false,
      isSuppressed: false,
      ...over,
    },
  };
}

describe("eligibility timing (re-evaluated at send)", () => {
  it("includes the recipient at preparation time", () => {
    const prep = resolveAudience([candidate()]);
    expect(prep.recipients).toHaveLength(1);
  });

  it("excludes a recipient who unsubscribed before the scheduled send", () => {
    const send = resolveAudience([candidate({ isUnsubscribed: true })]);
    expect(send.recipients).toHaveLength(0);
    expect(send.exclusions[0].reason).toBe("UNSUBSCRIBED");
  });

  it("excludes a recipient who was suppressed before the scheduled send", () => {
    const send = resolveAudience([candidate({ isSuppressed: true })]);
    expect(send.recipients).toHaveLength(0);
    expect(send.exclusions[0].reason).toBe("SUPPRESSED");
  });
});
