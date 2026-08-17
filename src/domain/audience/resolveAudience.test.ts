import { describe, it, expect } from "vitest";
import { resolveAudience, AudienceCandidate } from "./resolveAudience";
import { CrmBoardKind, EmailSourceType, ConsentStatus, EmailStatus, Language } from "../types";

const CUSTOMERS = "1903020743";
const CONTACTS = "1903020916";

function contactCandidate(itemId: string, email: string): AudienceCandidate {
  return {
    sourceBoardId: CONTACTS,
    sourceItemId: itemId,
    sourceEntityType: CrmBoardKind.CONTACTS,
    emailSourceType: EmailSourceType.CONTACT_EMAIL,
    rawEmail: email,
    contactId: `c-${itemId}`,
  };
}
function companyCandidate(itemId: string, email: string): AudienceCandidate {
  return {
    sourceBoardId: CUSTOMERS,
    sourceItemId: itemId,
    sourceEntityType: CrmBoardKind.CUSTOMERS,
    emailSourceType: EmailSourceType.COMPANY_EMAIL,
    rawEmail: email,
    companyId: `co-${itemId}`,
  };
}

describe("resolveAudience — deduplication", () => {
  it("collapses duplicate contacts with the same email into ONE recipient", () => {
    const r = resolveAudience([
      contactCandidate("1", "same@axis.com"),
      contactCandidate("2", "SAME@axis.com"),
    ]);
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].normalizedEmail).toBe("same@axis.com");
    expect(r.recipients[0].sources).toHaveLength(2);
    expect(r.snapshot.uniqueDestinations).toBe(1);
    expect(r.snapshot.duplicateSourcesCollapsed).toBe(1);
    expect(r.snapshot.excluded).toBe(0);
  });

  it("collapses company + contact sharing an email into ONE recipient, TWO sources", () => {
    const r = resolveAudience([
      companyCandidate("10", "shared@axis.com"),
      contactCandidate("20", "shared@axis.com"),
    ]);
    expect(r.recipients).toHaveLength(1);
    const types = r.recipients[0].sources.map((s) => s.emailSourceType).sort();
    expect(types).toEqual(["COMPANY_EMAIL", "CONTACT_EMAIL"]);
  });

  it("collapses many records across both boards into one recipient, preserving all sources", () => {
    const cands = [
      companyCandidate("a", "x@axis.com"),
      companyCandidate("b", "x@axis.com"),
      contactCandidate("c", "x@axis.com"),
      contactCandidate("d", "x@axis.com"),
    ];
    const r = resolveAudience(cands);
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].sources).toHaveLength(4);
    expect(r.snapshot.duplicateSourcesCollapsed).toBe(3);
  });

  it("does not attach the same CRM source twice (idempotent)", () => {
    const dup = contactCandidate("1", "same@axis.com");
    const r = resolveAudience([dup, { ...dup }]);
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].sources).toHaveLength(1);
    expect(r.snapshot.duplicateSourcesCollapsed).toBe(0);
  });

  it("resolving many candidates yields drafts only — never sends (no fan-out)", () => {
    const many: AudienceCandidate[] = Array.from({ length: 500 }, (_, i) =>
      contactCandidate(String(i), `bulk${i}@axis.com`),
    );
    const r = resolveAudience(many);
    expect(r.recipients).toHaveLength(500);
    // resolveAudience returns data; it has no send capability at all.
    expect("send" in r).toBe(false);
  });
});

describe("resolveAudience — exclusions (no fake recipient rows)", () => {
  const excluded: Array<[string, AudienceCandidate, string]> = [
    ["no email", { ...contactCandidate("1", ""), rawEmail: "" }, "NO_EMAIL"],
    ["invalid email", contactCandidate("2", "bad-email"), "INVALID_EMAIL"],
    [
      "unsubscribed",
      { ...contactCandidate("3", "u@axis.com"), address: prof({ isUnsubscribed: true }) },
      "UNSUBSCRIBED",
    ],
    [
      "suppressed",
      { ...contactCandidate("4", "s@axis.com"), address: prof({ isSuppressed: true }) },
      "SUPPRESSED",
    ],
    [
      "consent denied",
      { ...contactCandidate("5", "d@axis.com"), address: prof({ consentStatus: ConsentStatus.DENIED }) },
      "CONSENT_DENIED",
    ],
    ["archived", { ...contactCandidate("6", "a@axis.com"), sourceArchived: true }, "ARCHIVED"],
  ];

  it.each(excluded)("excludes %s without a recipient row", (_label, cand, reason) => {
    const r = resolveAudience([cand]);
    expect(r.recipients).toHaveLength(0);
    expect(r.exclusions).toHaveLength(1);
    expect(r.exclusions[0].reason).toBe(reason);
    expect(r.snapshot.breakdown[reason as keyof typeof r.snapshot.breakdown]).toBe(1);
  });

  it("excludes unknown language when required, no recipient row", () => {
    const r = resolveAudience(
      [{ ...contactCandidate("7", "l@axis.com"), address: prof({ language: Language.UNKNOWN }) }],
      { requireLanguage: Language.HE },
    );
    expect(r.recipients).toHaveLength(0);
    expect(r.exclusions[0].reason).toBe("LANGUAGE_UNKNOWN");
  });

  it("keeps a coherent funnel snapshot", () => {
    const r = resolveAudience([
      contactCandidate("1", "keep@axis.com"),
      contactCandidate("2", "keep@axis.com"), // collapses
      contactCandidate("3", ""), // no email
      contactCandidate("4", "bad"), // invalid
    ]);
    expect(r.snapshot.matchedRecords).toBe(4);
    expect(r.snapshot.withCandidateEmail).toBe(3);
    expect(r.snapshot.eligible).toBe(2);
    expect(r.snapshot.uniqueDestinations).toBe(1);
    expect(r.snapshot.duplicateSourcesCollapsed).toBe(1);
    expect(r.snapshot.excluded).toBe(2);
  });
});

function prof(over: Record<string, unknown> = {}) {
  return {
    emailStatus: EmailStatus.VALID,
    language: Language.UNKNOWN,
    consentStatus: ConsentStatus.UNKNOWN,
    isUnsubscribed: false,
    isSuppressed: false,
    ...over,
  } as AudienceCandidate["address"];
}
