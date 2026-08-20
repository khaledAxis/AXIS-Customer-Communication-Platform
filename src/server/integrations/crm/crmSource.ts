import type { RawMondayItem } from "../../../domain/crm/crmProjection";

/**
 * CrmSource port (ADR-0007 / ADR-0017).
 *
 * The sync service depends on THIS interface only — never on GraphQL or `fetch`.
 * Note what the interface deliberately does NOT expose: there is no create, update,
 * delete, or write method of any kind. The CRM is read-only by construction, not by
 * convention, and a mutation cannot be expressed through this port.
 */

export interface CrmBoardSnapshot {
  boardId: string;
  boardName: string | null;
  /** Total item count reported by the provider, for reconciliation. */
  itemCount: number;
  items: RawMondayItem[];
}

export interface CrmConfigStatus {
  configured: boolean;
  /** Sanitized reasons — never contains the API token. */
  problems: string[];
  message: string;
}

export interface CrmSource {
  readonly name: "MONDAY" | "FAKE";
  /** Cheap, local check — must never call the provider's API. */
  checkConfiguration(): CrmConfigStatus;
  /** Read every item of a board. Query-only. */
  fetchBoard(boardId: string): Promise<CrmBoardSnapshot>;
}

/** Raised when a read fails; carries a friendly message, never provider internals. */
export class CrmReadError extends Error {
  readonly code: string;
  readonly friendlyMessage: string;

  constructor(code: string, friendlyMessage: string) {
    super(`${code}: ${friendlyMessage}`);
    this.name = "CrmReadError";
    this.code = code;
    this.friendlyMessage = friendlyMessage;
  }
}
