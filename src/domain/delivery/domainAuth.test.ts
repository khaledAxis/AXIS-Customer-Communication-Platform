import { describe, expect, it } from "vitest";

import {
  interpretDomainReport,
  planSpfMerge,
  recommendDmarc,
  unknownDomainAuth,
  type RequiredDnsRecord,
} from "./domainAuth";

function record(
  purpose: RequiredDnsRecord["purpose"],
  status: string | null,
): RequiredDnsRecord {
  return {
    purpose,
    type: "TXT",
    name: `${purpose.toLowerCase()}.axis-gps.com`,
    value: "v=…",
    ttl: "auto",
    priority: null,
    status,
  };
}

describe("interpreting a provider domain report", () => {
  it("starts as UNKNOWN, not as NOT_VERIFIED", () => {
    // The distinction matters on screen: "we have not checked" and "the provider says
    // no" are different facts, and conflating them makes the second invisible.
    const unknown = unknownDomainAuth("axis-gps.com");
    expect(unknown.spf).toBe("UNKNOWN");
    expect(unknown.dkim).toBe("UNKNOWN");
    expect(unknown.verified).toBe(false);
  });

  it("reports verified only when the provider says exactly that", () => {
    const verified = interpretDomainReport({
      domain: "axis-gps.com",
      status: "verified",
      records: [record("SPF", "verified"), record("DKIM", "verified")],
    });
    expect(verified.verified).toBe(true);
    expect(verified.spf).toBe("VERIFIED");
    expect(verified.dkim).toBe("VERIFIED");
  });

  it("treats pending, failed and unrecognised statuses as not verified", () => {
    for (const status of ["pending", "failed", "partially_verified", "wat"]) {
      const result = interpretDomainReport({
        domain: "axis-gps.com",
        status,
        records: [record("SPF", status), record("DKIM", status)],
      });
      expect(result.verified).toBe(false);
      expect(result.spf).toBe("NOT_VERIFIED");
      expect(result.providerStatus).toBe(status);
    }
  });

  it("requires EVERY record of a mechanism to be verified", () => {
    const result = interpretDomainReport({
      domain: "axis-gps.com",
      status: "pending",
      records: [record("DKIM", "verified"), record("DKIM", "pending")],
    });
    expect(result.dkim).toBe("NOT_VERIFIED");
  });

  it("never claims DMARC from a provider report", () => {
    // AXIS publishes DMARC; no provider can confirm it, so the only honest answer is
    // "unknown" — even when the provider calls the whole domain verified.
    const result = interpretDomainReport({
      domain: "axis-gps.com",
      status: "verified",
      records: [record("SPF", "verified"), record("DKIM", "verified")],
    });
    expect(result.dmarc).toBe("UNKNOWN");
  });
});

describe("DMARC guidance", () => {
  it("starts at p=none and never recommends starting at reject", () => {
    const plan = recommendDmarc("axis-gps.com", "dmarc@axis-gps.com");
    expect(plan.host).toBe("_dmarc.axis-gps.com");
    expect(plan.value).toContain("p=none");
    expect(plan.stages[0].policy).toBe("p=none");
    expect(plan.stages.at(-1)?.policy).toBe("p=reject");
    expect(plan.notes.join(" ")).toMatch(/never begin at p=reject/i);
  });
});

describe("SPF merge planning", () => {
  it("inserts the include BEFORE the terminal all mechanism", () => {
    const plan = planSpfMerge("v=spf1 include:_spf.google.com ~all", "include:amazonses.com");
    expect(plan.recommended).toBe(
      "v=spf1 include:_spf.google.com include:amazonses.com ~all",
    );
  });

  it("warns that only ONE SPF record may exist", () => {
    const plan = planSpfMerge("v=spf1 include:_spf.google.com ~all", "include:amazonses.com");
    expect(plan.warnings.join(" ")).toMatch(/only ONE SPF record/i);
  });

  it("is a no-op when the provider is already authorised", () => {
    const existing = "v=spf1 include:amazonses.com ~all";
    const plan = planSpfMerge(existing, "include:amazonses.com");
    expect(plan.recommended).toBe(existing);
  });

  it("warns rather than guesses when no existing record was supplied", () => {
    const plan = planSpfMerge(null, "include:amazonses.com");
    expect(plan.hasExisting).toBe(false);
    expect(plan.recommended).toBe("v=spf1 include:amazonses.com ~all");
    expect(plan.warnings.join(" ")).toMatch(/MERGED, never duplicated/i);
  });

  it("warns when the record is near the 10-lookup limit", () => {
    const many = `v=spf1 ${Array.from({ length: 9 }, (_, i) => `include:h${i}.test`).join(" ")} ~all`;
    const plan = planSpfMerge(many, "include:amazonses.com");
    expect(plan.warnings.join(" ")).toMatch(/at most 10 DNS lookups/i);
  });
});
