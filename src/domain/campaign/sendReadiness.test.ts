import { describe, it, expect } from "vitest";

import {
  evaluateSendReadiness,
  preparationComplete,
  type ReadinessInput,
} from "./sendReadiness";

/** A campaign where everything a person controls has been done correctly. */
function input(overrides: {
  campaign?: Partial<ReadinessInput["campaign"]>;
  audience?: Partial<ReadinessInput["audience"]>;
  approval?: Partial<ReadinessInput["approval"]>;
} = {}): ReadinessInput {
  return {
    campaign: {
      status: "DRAFT",
      subject: "עדכון לקוחות",
      language: "HE",
      includedContentCount: 3,
      unapprovedExternalCount: 0,
      omittedImageCount: 0,
      ...overrides.campaign,
    },
    audience: {
      segmentSelected: true,
      finalAudiencePrepared: true,
      stalenessMessage: null,
      eligibleCount: 238,
      excludedCount: 41,
      exclusionsRecorded: 41,
      exclusionsTruncated: false,
      destinationsTruncated: false,
      consentNotConfirmedCount: 0,
      consentGrantedCount: 238,
      crmStaleMessage: null,
      ...overrides.audience,
    },
    approval: {
      approved: true,
      problem: null,
      fourEyesSatisfied: true,
      fourEyesProblem: null,
      ...overrides.approval,
    },
    production: { enabled: false },
  };
}

function status(result: ReturnType<typeof evaluateSendReadiness>, key: string) {
  return result.checks.find((c) => c.key === key)?.status;
}

describe("send readiness", () => {
  it("blocks on production even when everything else is ready", () => {
    const result = evaluateSendReadiness(input());
    expect(status(result, "production")).toBe("BLOCKED");
    expect(result.ready).toBe(false);
    // Everything a person controls is done; only the missing delivery engine remains.
    expect(preparationComplete(result)).toBe(true);
  });

  it("cannot be talked into enabling production", () => {
    const result = evaluateSendReadiness({
      ...input(),
      production: { enabled: true },
    });
    expect(status(result, "production")).toBe("BLOCKED");
    expect(result.ready).toBe(false);
  });

  it("blocks with no audience selected", () => {
    const result = evaluateSendReadiness(
      input({ audience: { segmentSelected: false } }),
    );
    expect(status(result, "segment")).toBe("BLOCKED");
    expect(preparationComplete(result)).toBe(false);
  });

  it("blocks with no content", () => {
    const result = evaluateSendReadiness(
      input({ campaign: { includedContentCount: 0 } }),
    );
    expect(status(result, "content")).toBe("BLOCKED");
    expect(preparationComplete(result)).toBe(false);
  });

  it("blocks with no subject", () => {
    expect(status(evaluateSendReadiness(input({ campaign: { subject: "  " } })), "subject")).toBe(
      "BLOCKED",
    );
  });

  it("blocks on unreviewed external articles", () => {
    const result = evaluateSendReadiness(
      input({ campaign: { unapprovedExternalCount: 2 } }),
    );
    expect(status(result, "content-approved")).toBe("BLOCKED");
  });

  it("blocks when nobody is eligible", () => {
    const result = evaluateSendReadiness(
      input({ audience: { eligibleCount: 0, consentGrantedCount: 0 } }),
    );
    expect(status(result, "eligible")).toBe("BLOCKED");
    expect(preparationComplete(result)).toBe(false);
  });

  it("blocks when no final audience has been prepared", () => {
    const result = evaluateSendReadiness(
      input({ audience: { finalAudiencePrepared: false } }),
    );
    expect(status(result, "final-audience")).toBe("BLOCKED");
    expect(status(result, "eligible")).toBe("BLOCKED");
  });

  it("blocks a stale audience and repeats the explanation verbatim", () => {
    const message = "Audience changed after snapshot. Prepare the final audience again.";
    const result = evaluateSendReadiness(
      input({ audience: { stalenessMessage: message } }),
    );
    expect(status(result, "final-audience")).toBe("BLOCKED");
    expect(result.checks.find((c) => c.key === "final-audience")?.detail).toBe(message);
  });

  it("blocks an unapproved campaign and shows the reason given", () => {
    const result = evaluateSendReadiness(
      input({ approval: { approved: false, problem: "Newsletter changed after approval." } }),
    );
    expect(status(result, "approval")).toBe("BLOCKED");
    expect(result.checks.find((c) => c.key === "approval")?.detail).toBe(
      "Newsletter changed after approval.",
    );
  });

  it("blocks when four-eyes is not satisfied", () => {
    const result = evaluateSendReadiness(
      input({
        approval: { fourEyesSatisfied: false, fourEyesProblem: "Nobody is signed in." },
      }),
    );
    expect(status(result, "four-eyes")).toBe("BLOCKED");
    expect(preparationComplete(result)).toBe(false);
  });

  it("warns, and does not block, on unconfirmed consent", () => {
    const result = evaluateSendReadiness(
      input({ audience: { consentNotConfirmedCount: 12, consentGrantedCount: 226 } }),
    );
    expect(status(result, "consent")).toBe("WARNING");
    expect(preparationComplete(result)).toBe(true);
    expect(result.checks.find((c) => c.key === "consent")?.detail).toContain("12");
  });

  it("warns, and does not block, on omitted pictures", () => {
    const result = evaluateSendReadiness(input({ campaign: { omittedImageCount: 1 } }));
    expect(status(result, "images")).toBe("WARNING");
    expect(preparationComplete(result)).toBe(true);
  });

  it("warns, and does not block, on stale customer data", () => {
    const result = evaluateSendReadiness(
      input({ audience: { crmStaleMessage: "Last synced 40 hours ago." } }),
    );
    expect(status(result, "crm-freshness")).toBe("WARNING");
    expect(preparationComplete(result)).toBe(true);
  });

  it("reports a truncated snapshot instead of hiding it", () => {
    const result = evaluateSendReadiness(
      input({
        audience: {
          excludedCount: 50_000,
          exclusionsRecorded: 20_000,
          exclusionsTruncated: true,
        },
      }),
    );
    const check = result.checks.find((c) => c.key === "exclusions-recorded");
    expect(check?.status).toBe("WARNING");
    expect(check?.detail).toContain("20,000");
    expect(check?.detail).toContain("50,000");
  });

  it("blocks a campaign that has already been sent", () => {
    for (const state of ["SENT", "CANCELED", "FAILED"]) {
      const result = evaluateSendReadiness(input({ campaign: { status: state } }));
      expect(status(result, "campaign-state")).toBe("BLOCKED");
    }
  });

  it("states the unsubscribe and blocked rules rather than re-deriving them", () => {
    // There is exactly one eligibility engine; this check must never become a second.
    const check = evaluateSendReadiness(input()).checks.find(
      (c) => c.key === "eligibility-engine",
    );
    expect(check?.status).toBe("READY");
    expect(check?.detail).toContain("Unsubscribed");
  });

  it("is deterministic", () => {
    expect(evaluateSendReadiness(input())).toEqual(evaluateSendReadiness(input()));
  });
});
