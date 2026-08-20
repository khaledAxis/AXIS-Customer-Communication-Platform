import type { RawMondayItem } from "../../../domain/crm/crmProjection";
import { REQUESTED_COLUMNS } from "../../../domain/crm/mondayColumns";
import {
  CrmReadError,
  type CrmBoardSnapshot,
  type CrmConfigStatus,
  type CrmSource,
} from "./crmSource";

/**
 * Monday.com adapter — the ONLY code aware of Monday's GraphQL API (ADR-0017).
 *
 * READ-ONLY BY CONSTRUCTION. Every GraphQL document in this file begins with the
 * `query` keyword; there is no code path that builds a mutation, and the port it
 * implements exposes no write method. A regression test greps this file for mutation
 * constructs.
 *
 * `MONDAY_API_TOKEN` is a secret: it is never logged, returned, persisted, or exposed
 * to the browser.
 */

const API_URL = process.env.MONDAY_API_URL ?? "https://api.monday.com/v2";
const API_VERSION = "2024-10";
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 60_000;

interface GraphQlColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  /**
   * Only present on board_relation columns, via the typed inline fragment.
   *
   * Required: from API version 2024-10 a board_relation column returns null for BOTH
   * `text` and `value`, so the generic fields cannot see relations at all.
   */
  linked_item_ids?: (string | number)[] | null;
}

interface GraphQlItem {
  id: string;
  name: string | null;
  updated_at?: string | null;
  column_values: GraphQlColumnValue[];
}

function readToken(): string {
  return (process.env.MONDAY_API_TOKEN ?? "").trim();
}

/**
 * Linked item ids for a board_relation column.
 *
 * Monday returns them in the JSON `value` as `{ linkedPulseIds: [{ linkedPulseId }] }`.
 * A malformed value yields an empty list rather than throwing — one bad relation must
 * not abort a whole board read.
 */
function parseLinkedIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as {
      linkedPulseIds?: { linkedPulseId?: number | string }[];
  };
    const linked = parsed?.linkedPulseIds;
    if (!Array.isArray(linked)) return [];
    return linked
      .map((entry) => entry?.linkedPulseId)
      .filter((id): id is number | string => id !== undefined && id !== null)
      .map((id) => String(id));
  } catch {
    return [];
  }
}

function toRawItem(boardId: string, item: GraphQlItem): RawMondayItem {
  const columns: Record<string, string | null> = {};
  const relations: Record<string, string[]> = {};

  for (const cv of item.column_values) {
    columns[cv.id] = cv.text;
    if (cv.id.startsWith("board_relation_")) {
      // Prefer the typed field; fall back to the legacy JSON payload.
      relations[cv.id] = Array.isArray(cv.linked_item_ids)
        ? cv.linked_item_ids.map((id) => String(id))
        : parseLinkedIds(cv.value);
    }
  }

  return {
    boardId,
    itemId: item.id,
    name: item.name,
    updatedAt: item.updated_at ?? null,
    columns,
    relations,
    // Preserved for troubleshooting/audit (docs/requirements §8.4).
    raw: item,
  };
}

export class MondayCrmSource implements CrmSource {
  readonly name = "MONDAY" as const;

  checkConfiguration(): CrmConfigStatus {
    const token = readToken();
    if (token === "") {
      return {
        configured: false,
        problems: ["MONDAY_API_TOKEN is not set."],
        message: "Monday CRM is not connected",
      };
    }
    if (token.length < 40) {
      // Shape check only — the value itself is never inspected further or echoed.
      return {
        configured: false,
        problems: ["MONDAY_API_TOKEN looks like a placeholder rather than a real token."],
        message: "Monday CRM is not connected",
      };
    }
    return { configured: true, problems: [], message: "Monday CRM connected" };
  }

  /** Issues a single GraphQL **query**. No mutation is ever constructed. */
  private async query<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    const token = readToken();
    if (token === "") {
      throw new CrmReadError("NOT_CONFIGURED", "Monday CRM is not connected.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "API-Version": API_VERSION,
        },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      });
    } catch {
      throw new CrmReadError(
        "MONDAY_UNREACHABLE",
        "Could not reach Monday.com. Please check the connection and try again.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new CrmReadError(
        "MONDAY_UNAUTHORIZED",
        "Monday.com rejected the access token. Please check the CRM configuration.",
      );
    }
    if (response.status === 429) {
      throw new CrmReadError(
        "MONDAY_RATE_LIMITED",
        "Monday.com is limiting requests right now. Please wait a moment and try again.",
      );
    }
    if (!response.ok) {
      throw new CrmReadError("MONDAY_HTTP_ERROR", "Monday.com could not complete the request.");
    }

    let payload: { data?: T; errors?: { message?: string }[] };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new CrmReadError("MONDAY_BAD_RESPONSE", "Monday.com returned an unreadable response.");
    }

    if (payload.errors?.length) {
      // Provider messages can echo the request; keep them out of the user-facing text.
      throw new CrmReadError("MONDAY_QUERY_ERROR", "Monday.com could not complete the request.");
    }
    if (!payload.data) {
      throw new CrmReadError("MONDAY_EMPTY_RESPONSE", "Monday.com returned no data.");
    }
    return payload.data;
  }

  async fetchBoard(boardId: string): Promise<CrmBoardSnapshot> {
    const columnIds = REQUESTED_COLUMNS[boardId] ?? [];

    // ---- first page (also carries the board metadata) ----
    const first = await this.query<{
      boards: {
        id: string;
        name: string | null;
        items_count: number | null;
        items_page: { cursor: string | null; items: GraphQlItem[] };
      }[];
    }>(
      `query ($id: [ID!], $columns: [String!], $limit: Int!) {
         boards (ids: $id) {
           id
           name
           items_count
           items_page (limit: $limit) {
             cursor
             items {
               id
               name
               updated_at
               column_values (ids: $columns) {
                 id
                 text
                 value
                 ... on BoardRelationValue { linked_item_ids }
               }
             }
           }
         }
       }`,
      { id: [boardId], columns: columnIds, limit: PAGE_SIZE },
    );

    const board = first.boards?.[0];
    if (!board) {
      throw new CrmReadError(
        "MONDAY_BOARD_NOT_FOUND",
        "That Monday board could not be found or is not shared with this application.",
      );
    }

    const items: RawMondayItem[] = board.items_page.items.map((item) => toRawItem(boardId, item));
    let cursor = board.items_page.cursor;

    // ---- remaining pages ----
    while (cursor) {
      const next = await this.query<{
        next_items_page: { cursor: string | null; items: GraphQlItem[] };
      }>(
        `query ($cursor: String!, $columns: [String!], $limit: Int!) {
           next_items_page (cursor: $cursor, limit: $limit) {
             cursor
             items {
               id
               name
               updated_at
               column_values (ids: $columns) {
                 id
                 text
                 value
                 ... on BoardRelationValue { linked_item_ids }
               }
             }
           }
         }`,
        { cursor, columns: columnIds, limit: PAGE_SIZE },
      );

      const page = next.next_items_page;
      if (!page) break;
      items.push(...page.items.map((item) => toRawItem(boardId, item)));
      cursor = page.cursor;
    }

    return {
      boardId,
      boardName: board.name,
      itemCount: board.items_count ?? items.length,
      items,
    };
  }
}
