import type { RawMondayItem } from "../../../domain/crm/crmProjection";
import type { CrmBoardSnapshot, CrmConfigStatus, CrmSource } from "./crmSource";

/**
 * In-memory CRM source used by tests.
 *
 * Performs no network I/O, so no test can reach Monday.com even by accident. Like the
 * real adapter it exposes no write method — a mutation is unrepresentable.
 */
export class FakeCrmSource implements CrmSource {
  readonly name = "FAKE" as const;

  readonly reads: string[] = [];

  constructor(
    private boards: Record<string, RawMondayItem[]> = {},
    private behaviour: { configured?: boolean; failBoard?: string } = {},
  ) {}

  /** Replace a board's contents between syncs to simulate CRM changes. */
  setBoard(boardId: string, items: RawMondayItem[]): void {
    this.boards[boardId] = items;
  }

  checkConfiguration(): CrmConfigStatus {
    const configured = this.behaviour.configured ?? true;
    return {
      configured,
      problems: configured ? [] : ["Fake CRM source is not configured."],
      message: configured ? "Monday CRM connected" : "Monday CRM is not connected",
    };
  }

  async fetchBoard(boardId: string): Promise<CrmBoardSnapshot> {
    this.reads.push(boardId);
    if (this.behaviour.failBoard === boardId) {
      throw new Error("simulated board read failure");
    }
    const items = this.boards[boardId] ?? [];
    return { boardId, boardName: `fake-${boardId}`, itemCount: items.length, items };
  }
}
