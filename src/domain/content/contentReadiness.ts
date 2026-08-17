/**
 * Pure campaign-content rules (ADR-0010).
 *
 * A campaign cannot be approved/sent for production unless it has selected,
 * included content, all INGESTED (external) content is APPROVED, and (for send)
 * every included item has a frozen snapshot. Automatic ingestion NEVER implies
 * automatic sending — external content must be human-approved first.
 */

export type ContentOrigin = "INTERNAL" | "INGESTED";
export type ReviewState = "NEW" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export interface SelectedContent {
  contentItemId: string;
  position: number;
  isIncluded: boolean;
  origin: ContentOrigin;
  reviewState: ReviewState;
  hasSnapshot: boolean;
}

export type ReadinessProblem =
  | "NO_CONTENT"
  | "UNAPPROVED_EXTERNAL_CONTENT"
  | "MISSING_SNAPSHOT";

export interface ReadinessInput {
  selected: SelectedContent[];
  /** true when evaluating readiness to SEND (snapshot must be frozen). */
  requireSnapshot?: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  problems: ReadinessProblem[];
  includedCount: number;
}

/** Items to include, in deterministic delivery order (by position, then id). */
export function orderedIncluded(selected: SelectedContent[]): SelectedContent[] {
  return selected
    .filter((s) => s.isIncluded)
    .slice()
    .sort((a, b) => a.position - b.position || a.contentItemId.localeCompare(b.contentItemId));
}

export function evaluateCampaignReadiness(input: ReadinessInput): ReadinessResult {
  const included = orderedIncluded(input.selected);
  const problems: ReadinessProblem[] = [];

  if (included.length === 0) {
    problems.push("NO_CONTENT");
  }
  if (included.some((c) => c.origin === "INGESTED" && c.reviewState !== "APPROVED")) {
    problems.push("UNAPPROVED_EXTERNAL_CONTENT");
  }
  if (input.requireSnapshot && included.some((c) => !c.hasSnapshot)) {
    problems.push("MISSING_SNAPSHOT");
  }

  return { ready: problems.length === 0, problems, includedCount: included.length };
}

// ---------------------------------------------------------------------------
// Snapshot freezing — the frozen copy is the authoritative record of what was
// sent and must not change when the source ContentItem is edited later.
// ---------------------------------------------------------------------------
export interface ContentForSnapshot {
  title: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
  externalUrl?: string | null;
}

export interface FrozenContentSnapshot {
  snapshotTitle: string;
  snapshotBodyHtml: string | null;
  snapshotBodyText: string | null;
  snapshotExternalUrl: string | null;
}

export function freezeContentSnapshot(c: ContentForSnapshot): FrozenContentSnapshot {
  // Copy primitives — the returned snapshot is decoupled from the source object.
  return {
    snapshotTitle: c.title,
    snapshotBodyHtml: c.bodyHtml ?? null,
    snapshotBodyText: c.bodyText ?? null,
    snapshotExternalUrl: c.externalUrl ?? null,
  };
}
