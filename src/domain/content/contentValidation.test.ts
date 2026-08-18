import { describe, it, expect } from "vitest";

import {
  CampaignNotEditableError,
  LIMITS,
  assertCampaignEditable,
  isCampaignDeletable,
  isCampaignEditable,
  validateContentDraft,
  validateNewsletterDetails,
} from "./contentValidation";

const validContent = { title: "A good article", language: "HE" };

describe("content validation", () => {
  it("accepts a minimal valid article", () => {
    expect(validateContentDraft(validContent).ok).toBe(true);
  });

  it("requires a title", () => {
    const result = validateContentDraft({ ...validContent, title: "" });
    expect(result.ok).toBe(false);
    expect(result.errors[0].field).toBe("title");
  });

  it("rejects a whitespace-only title", () => {
    expect(validateContentDraft({ ...validContent, title: "   " }).ok).toBe(false);
  });

  it("rejects an over-long title", () => {
    expect(validateContentDraft({ ...validContent, title: "x".repeat(LIMITS.title + 1) }).ok).toBe(
      false,
    );
  });

  it("rejects an over-long summary and body", () => {
    expect(
      validateContentDraft({ ...validContent, summary: "x".repeat(LIMITS.summary + 1) }).ok,
    ).toBe(false);
    expect(validateContentDraft({ ...validContent, body: "x".repeat(LIMITS.body + 1) }).ok).toBe(
      false,
    );
  });

  it("rejects an unknown language", () => {
    const result = validateContentDraft({ ...validContent, language: "EN" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === "language")).toBe(true);
  });

  it("accepts the three supported languages", () => {
    for (const language of ["HE", "AR", "UNKNOWN"]) {
      expect(validateContentDraft({ ...validContent, language }).ok).toBe(true);
    }
  });

  it("rejects a dangerous link", () => {
    for (const externalUrl of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
      const result = validateContentDraft({ ...validContent, externalUrl });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "externalUrl")).toBe(true);
    }
  });

  it("accepts a normal https link", () => {
    expect(validateContentDraft({ ...validContent, externalUrl: "https://axis-gps.com/a" }).ok).toBe(
      true,
    );
  });

  it("rejects an unparseable published date", () => {
    expect(validateContentDraft({ ...validContent, publishedAt: "not-a-date" }).ok).toBe(false);
  });

  it("reports every problem at once rather than one at a time", () => {
    const result = validateContentDraft({ title: "", language: "EN", externalUrl: "javascript:x" });
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("uses friendly messages with no technical terms", () => {
    const result = validateContentDraft({ title: "", language: "EN" });
    for (const error of result.errors) {
      expect(error.message).not.toMatch(/prisma|enum|null|undefined|varchar|constraint/i);
    }
  });
});

describe("newsletter details validation", () => {
  const valid = { name: "September update", subject: "What is new", language: "HE" };

  it("accepts valid details", () => {
    expect(validateNewsletterDetails(valid).ok).toBe(true);
  });

  it("requires a name and a subject", () => {
    expect(validateNewsletterDetails({ ...valid, name: "" }).ok).toBe(false);
    expect(validateNewsletterDetails({ ...valid, subject: "" }).ok).toBe(false);
  });

  it("rejects an over-long subject or preview text", () => {
    expect(validateNewsletterDetails({ ...valid, subject: "x".repeat(LIMITS.subject + 1) }).ok).toBe(
      false,
    );
    expect(
      validateNewsletterDetails({ ...valid, preheader: "x".repeat(LIMITS.preheader + 1) }).ok,
    ).toBe(false);
  });

  it("rejects an unsupported language", () => {
    expect(validateNewsletterDetails({ ...valid, language: "EN" }).ok).toBe(false);
  });
});

describe("newsletter editability and deletion", () => {
  it("allows editing only in draft", () => {
    expect(isCampaignEditable("DRAFT")).toBe(true);
    for (const status of ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENDING", "SENT", "FAILED"]) {
      expect(isCampaignEditable(status)).toBe(false);
    }
  });

  it("throws a friendly error when editing a locked newsletter", () => {
    expect(() => assertCampaignEditable("SENT")).toThrow(CampaignNotEditableError);
    expect(() => assertCampaignEditable("DRAFT")).not.toThrow();
  });

  it("never allows deleting a newsletter that has history", () => {
    for (const status of ["DRAFT", "REJECTED", "CANCELED", "SENT"]) {
      expect(isCampaignDeletable(status, true)).toBe(false);
    }
  });

  it("allows deleting an untouched draft", () => {
    expect(isCampaignDeletable("DRAFT", false)).toBe(true);
  });

  it("never allows deleting a sent newsletter even without counted history", () => {
    expect(isCampaignDeletable("SENT", false)).toBe(false);
    expect(isCampaignDeletable("SENDING", false)).toBe(false);
  });
});
