import { describe, it, expect } from "vitest";
import {
  evaluateCampaignReadiness,
  orderedIncluded,
  freezeContentSnapshot,
  SelectedContent,
} from "./contentReadiness";

const item = (over: Partial<SelectedContent> = {}): SelectedContent => ({
  contentItemId: "ci",
  position: 0,
  isIncluded: true,
  origin: "INTERNAL",
  reviewState: "APPROVED",
  hasSnapshot: true,
  ...over,
});

describe("campaign multi-content readiness", () => {
  it("supports multiple content items in deterministic position order", () => {
    const ordered = orderedIncluded([
      item({ contentItemId: "b", position: 2 }),
      item({ contentItemId: "a", position: 1 }),
      item({ contentItemId: "c", position: 3 }),
    ]);
    expect(ordered.map((c) => c.contentItemId)).toEqual(["a", "b", "c"]);
  });

  it("is not ready with no included content", () => {
    const r = evaluateCampaignReadiness({ selected: [item({ isIncluded: false })] });
    expect(r.ready).toBe(false);
    expect(r.problems).toContain("NO_CONTENT");
  });

  it("is ready with internal approved content", () => {
    const r = evaluateCampaignReadiness({ selected: [item()] });
    expect(r).toEqual({ ready: true, problems: [], includedCount: 1 });
  });

  it("is not production-ready while external content is unapproved", () => {
    const r = evaluateCampaignReadiness({
      selected: [item({ origin: "INGESTED", reviewState: "PENDING_REVIEW" })],
    });
    expect(r.ready).toBe(false);
    expect(r.problems).toContain("UNAPPROVED_EXTERNAL_CONTENT");
  });

  it("becomes ready once external content is approved", () => {
    const r = evaluateCampaignReadiness({
      selected: [item({ origin: "INGESTED", reviewState: "APPROVED" })],
    });
    expect(r.ready).toBe(true);
  });

  it("requires a snapshot when evaluating send-readiness", () => {
    const r = evaluateCampaignReadiness({
      selected: [item({ hasSnapshot: false })],
      requireSnapshot: true,
    });
    expect(r.problems).toContain("MISSING_SNAPSHOT");
  });
});

describe("content snapshot immutability", () => {
  it("frozen snapshot does not change when the source item is edited later", () => {
    const source = { title: "Original", bodyHtml: "<p>v1</p>", externalUrl: null };
    const snap = freezeContentSnapshot(source);
    // simulate later editing of the original ContentItem
    source.title = "EDITED";
    source.bodyHtml = "<p>v2</p>";
    expect(snap.snapshotTitle).toBe("Original");
    expect(snap.snapshotBodyHtml).toBe("<p>v1</p>");
  });

  it("keeps link-only external content (no HTML) reproducible", () => {
    const snap = freezeContentSnapshot({ title: "Trimble news", externalUrl: "https://example.com/a" });
    expect(snap.snapshotBodyHtml).toBeNull();
    expect(snap.snapshotExternalUrl).toBe("https://example.com/a");
  });
});
