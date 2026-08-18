import { describe, it, expect } from "vitest";
import { resolveDelivery, defaultSendMode, SafeSendConfig } from "./safeSend";

const cfg = (mode: "TEST" | "PRODUCTION"): SafeSendConfig => ({
  mode,
  safeFrom: "axisgpscana@gmail.com",
  safeRedirectTo: "khaled-s@axis-gps.com",
});

describe("safe-send resolver", () => {
  it("defaults to TEST mode", () => {
    expect(defaultSendMode()).toBe("TEST");
  });

  it("in TEST, a real CRM address is never the provider destination", () => {
    const d = resolveDelivery("real.customer@bigco.com", cfg("TEST"));
    expect(d.toEmail).toBe("khaled-s@axis-gps.com");
    expect(d.fromEmail).toBe("axisgpscana@gmail.com");
    expect(d.intendedEmail).toBe("real.customer@bigco.com");
    expect(d.isRedirected).toBe(true);
  });

  it("in TEST, every intended address redirects to the single safe-send address", () => {
    for (const intended of ["a@x.com", "b@y.com", "c@z.com"]) {
      expect(resolveDelivery(intended, cfg("TEST")).toEmail).toBe("khaled-s@axis-gps.com");
    }
  });

  it("in PRODUCTION, the intended address is used", () => {
    const d = resolveDelivery("real.customer@bigco.com", cfg("PRODUCTION"));
    expect(d.toEmail).toBe("real.customer@bigco.com");
    expect(d.isRedirected).toBe(false);
  });
});
