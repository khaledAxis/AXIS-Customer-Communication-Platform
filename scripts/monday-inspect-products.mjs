// Read-only inspection of the two Monday product boards.
// Contains ONLY GraphQL `query` operations — NO mutations, no writes.
//
// Purpose: discover the real column ids/titles/types for the product catalogue and
// customer-owned-products boards so the sync mapping is based on fact, not guesses.
// Values are masked; the API token is never printed.
//
//   node scripts/monday-inspect-products.mjs

import { readFileSync } from "node:fs";

const API_URL = process.env.MONDAY_API_URL || "https://api.monday.com/v2";

const PRODUCT_CATALOGUE_BOARD = "1903021552";
const CUSTOMER_PRODUCTS_BOARD = "1903021951";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at === -1) continue;
      const key = trimmed.slice(0, at).trim();
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local is optional here; the token may come from the environment.
  }
}

/** Only `query` documents are ever passed to this function. */
async function gql(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN ?? "",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error("Monday returned errors:", json.errors.map((e) => e.message).join("; "));
  }
  return json;
}

/** Never echo real customer data — show only the shape of a value. */
function shape(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  const text = String(value);
  if (text.length > 48) return `${text.slice(0, 45)}…`;
  return text;
}

async function inspectBoard(boardId, label) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${label}  (board ${boardId})`);
  console.log("=".repeat(78));

  const meta = await gql(
    `query ($id: [ID!]) {
       boards (ids: $id) {
         id
         name
         items_count
         columns { id title type }
       }
     }`,
    { id: [boardId] },
  );

  const board = meta.json?.boards?.[0] ?? meta.data?.boards?.[0];
  if (!board) {
    console.log("  board not accessible");
    return;
  }

  console.log(`  name        : ${board.name}`);
  console.log(`  items_count : ${board.items_count}`);
  console.log(`  columns     : ${board.columns.length}`);
  console.log("");
  console.log("  COLUMN ID                        TYPE             TITLE");
  console.log("  " + "-".repeat(74));
  for (const column of board.columns) {
    console.log(
      `  ${column.id.padEnd(32)} ${String(column.type).padEnd(16)} ${column.title}`,
    );
  }

  // One sample item, masked, to confirm which columns actually carry data.
  const sample = await gql(
    `query ($id: [ID!]) {
       boards (ids: $id) {
         items_page (limit: 3) {
           items {
             id
             name
             column_values { id type text }
           }
         }
       }
     }`,
    { id: [boardId] },
  );

  const items =
    sample.json?.boards?.[0]?.items_page?.items ?? sample.data?.boards?.[0]?.items_page?.items ?? [];
  console.log(`\n  SAMPLE (${items.length} item(s), values shortened):`);
  for (const item of items) {
    console.log(`   • item ${item.id} — ${shape(item.name)}`);
    for (const cv of item.column_values) {
      if (cv.text && cv.text !== "") {
        console.log(`       ${cv.id.padEnd(30)} ${String(cv.type).padEnd(14)} ${shape(cv.text)}`);
      }
    }
  }
}

async function main() {
  loadEnvLocal();
  if (!process.env.MONDAY_API_TOKEN) {
    console.error("MONDAY_API_TOKEN is not set (checked environment and .env.local).");
    process.exit(1);
  }
  await inspectBoard(PRODUCT_CATALOGUE_BOARD, "PRODUCT CATALOGUE");
  await inspectBoard(CUSTOMER_PRODUCTS_BOARD, "CUSTOMER-OWNED PRODUCTS / SUBSCRIPTIONS");
  console.log("\nDone. Read-only: only `query` operations were issued.\n");
}

main().catch((error) => {
  console.error("Inspection failed:", error?.message ?? "unknown error");
  process.exit(1);
});
