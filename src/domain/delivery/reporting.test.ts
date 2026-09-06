import { describe, expect, it } from "vitest";
import { csvCell, reportRange } from "./reporting";
import { assertCampaignTransition } from "../campaign/lifecycle";
import { assertCustomerEnvelope } from "./customerEnvelope";
describe("report boundaries and dispatch invariants", () => {
  it("validates real UTC dates and inclusive end dates", () => {
    expect(reportRange("2026-09-01", "2026-09-05").until.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    for (const dates of [["2026-02-30","2026-03-01"],["2026-09-06","2026-09-05"],["2020-01-01","2026-01-01"]])
      expect(() => reportRange(...dates as [string,string])).toThrow();
  });
  it("neutralizes spreadsheet formulas and quotes multiline customer data", () => {
    for (const value of ["=SUM(A1)"," +1", "\t@SUM(A1)","-1+2","\r=1"]) expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("enforces lifecycle transitions and terminal history", () => {
    expect(() => assertCampaignTransition("DRAFT","SENDING")).toThrow();
    expect(() => assertCampaignTransition("SCHEDULED","SENDING")).not.toThrow();
    for (const state of ["SENT","FAILED","CANCELED"] as const) expect(() => assertCampaignTransition(state,"DRAFT")).toThrow();
  });
  it("customer envelopes cannot widen the audience or inject a header", () => {
    const message = { to: "person@example.com", subject: "Update", html: "body", text: "body", idempotencyKey: "axis-customer-" + "a".repeat(64) };
    expect(() => assertCustomerEnvelope(message)).not.toThrow();
    for (const patch of [{ cc: "second@example.com" },{ replyTo: "x@example.com" },{to:[message.to]},{to:"a@example.com,b@example.com"},{subject:"Hello\r\nBcc: x@example.com"},{idempotencyKey:"pilot-key"}])
      expect(() => assertCustomerEnvelope({ ...message, ...patch } as unknown as typeof message)).toThrow();
  });
});
