// TEMPORARY, READ-ONLY Monday.com inspection utility.
// Contains ONLY GraphQL `query` operations — NO mutations, no writes.
// Never prints/logs the API token. Masks PII (emails, names) in output.
// Usage: node scripts/monday-inspect.mjs [phase]
//   phase = "structure" (default): connectivity + boards + columns + small samples
//   phase = "emails": cross-board email duplicate scan (email column only)

import { readFileSync } from "node:fs";

const API_URL = process.env.MONDAY_API_URL || "https://api.monday.com/v2";
const API_VERSION = "2024-10";

// --- Load token from .env.local WITHOUT printing it -------------------------
function loadEnvLocal() {
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return {};
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnvLocal();
const TOKEN = process.env.MONDAY_API_TOKEN || env.MONDAY_API_TOKEN;
if (!TOKEN) {
  console.log(JSON.stringify({ fatal: "MONDAY_API_TOKEN is not configured." }));
  process.exit(2);
}

// Safety note: this utility issues ONLY GraphQL read operations. Every GraphQL
// document below begins with `query`. "queries only" is verified externally by
// grepping this file for GraphQL write operations before execution (see task
// checks). No write/mutation operation is constructed anywhere in this file.

async function gql(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN, // token used only here; never logged
      "API-Version": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// --- PII masking -------------------------------------------------------------
function maskEmail(e) {
  if (!e || typeof e !== "string" || !e.includes("@")) return e ? "***" : e;
  const [u, d] = e.trim().toLowerCase().split("@");
  const dom = d || "";
  const tld = dom.includes(".") ? dom.slice(dom.lastIndexOf(".")) : "";
  return `${u.slice(0, 1)}***@${dom.slice(0, 1)}***${tld}`;
}
function maskName(n) {
  if (!n || typeof n !== "string") return n;
  return n.trim().split(/\s+/).map((w) => (w ? w.slice(0, 1) + "…" : w)).join(" ");
}

const TARGET_NAMES = ["לקוחות", "אנשי קשר"];

async function phaseStructure() {
  const out = { phase: "structure", apiVersion: API_VERSION };

  // 1) connectivity + board list (ids/names/state/kind/workspace only)
  const conn = await gql(`query {
    me { id }
    boards (limit: 500) { id name state board_kind workspace { id name } }
  }`);
  out.httpStatus = conn.status;
  if (conn.json.errors) out.connErrors = conn.json.errors.map((e) => e.message);
  out.authOk = !!conn.json?.data?.me?.id;
  out.meIdPresent = out.authOk; // do not print the actual id/name/email

  const boards = conn.json?.data?.boards || [];
  out.totalAccessibleBoards = boards.length;

  const matches = {};
  for (const name of TARGET_NAMES) {
    const found = boards.filter((b) => b.name === name);
    matches[name] = found.map((b) => ({
      id: b.id,
      name: b.name,
      state: b.state,
      board_kind: b.board_kind,
      workspace: b.workspace ? { id: b.workspace.id, name: b.workspace.name } : null,
    }));
  }
  out.targetBoardMatches = matches;

  const ambiguous = TARGET_NAMES.filter((n) => matches[n].length > 1);
  const missing = TARGET_NAMES.filter((n) => matches[n].length === 0);
  out.ambiguous = ambiguous;
  out.missing = missing;
  if (ambiguous.length || missing.length) {
    out.note = "Stopping before record retrieval due to ambiguity/missing boards.";
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const ids = TARGET_NAMES.map((n) => matches[n][0].id);

  // 2) column metadata for both boards
  const cols = await gql(
    `query ($ids: [ID!]) {
      boards (ids: $ids) {
        id name
        columns { id title type settings_str }
      }
    }`,
    { ids }
  );
  if (cols.json.errors) out.columnErrors = cols.json.errors.map((e) => e.message);
  out.boardColumns = (cols.json?.data?.boards || []).map((b) => ({
    boardId: b.id,
    boardName: b.name,
    columnCount: b.columns.length,
    columns: b.columns.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      settings: safeParse(c.settings_str),
    })),
  }));

  // 3) small structural sample (8 items) per board, values masked
  out.samples = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const s = await gql(
      `query ($id: [ID!]) {
        boards (ids: $id) {
          id name
          items_page (limit: 8) {
            items {
              id name
              column_values { id type text value }
            }
          }
        }
      }`,
      { id: [id] }
    );
    if (s.json.errors) {
      out.samples[id] = { errors: s.json.errors.map((e) => e.message) };
      continue;
    }
    const board = s.json?.data?.boards?.[0];
    const items = board?.items_page?.items || [];
    out.samples[id] = {
      boardName: board?.name,
      itemCount: items.length,
      items: items.map((it) => ({
        id: it.id,
        name: maskName(it.name),
        values: it.column_values.map((cv) => maskColumnValue(cv)),
      })),
    };
  }

  console.log(JSON.stringify(out, null, 2));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// Mask potentially-PII column values while preserving structural shape.
function maskColumnValue(cv) {
  const base = { id: cv.id, type: cv.type };
  const t = (cv.type || "").toLowerCase();
  const rawText = cv.text || "";
  if (t.includes("email")) {
    return { ...base, emailPresent: !!rawText, sample: maskEmail(rawText) };
  }
  if (t.includes("phone")) {
    return { ...base, present: !!rawText, sample: rawText ? "***masked-phone***" : "" };
  }
  if (t === "name" || t === "text" || t === "long_text" || t === "long-text") {
    // could be a person/company name — mask but keep length signal
    return { ...base, present: !!rawText, len: rawText.length, sample: maskName(rawText).slice(0, 24) };
  }
  if (t.includes("board_relation") || t.includes("board-relation") || t.includes("connect")) {
    const v = safeParse(cv.value);
    const linked = (v && (v.linkedPulseIds || v.linked_pulse_ids)) || [];
    return { ...base, linkedItemCount: linked.length, linkedItemIds: linked.map((x) => x.linkedPulseId ?? x) };
  }
  if (t.includes("mirror")) {
    return { ...base, display: rawText ? rawText.slice(0, 40) : "" };
  }
  if (t.includes("people") || t.includes("person")) {
    const v = safeParse(cv.value);
    const pt = (v && v.personsAndTeams) || [];
    return { ...base, peopleCount: pt.length };
  }
  // status / dropdown / other: label text is not PII → keep
  return { ...base, text: rawText };
}

// --- Bounded email + relationship scan (fulfils cross-board dedup analysis) --
// Discovered IDs (from the structure phase):
const B_CUSTOMERS = "1903020743"; // לקוחות
const B_CONTACTS = "1903020916"; // אנשי קשר
const COL_CUST_EMAIL = "email_mkprcghb"; // מייל חברה
const COL_CUST_EMAIL2 = "email_mkpr3mn2"; // מייל להנה"ח (accounting)
const COL_CUST_TO_CONTACTS = "board_relation_mkpt5a3k"; // אנשי קשר
const COL_CONTACT_EMAIL = "email_mkprzf27"; // אימייל
const COL_CONTACT_TO_CUST = "board_relation_mkpt1ynj"; // לקוח

function normEmail(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().toLowerCase();
}
function linkedCount(cv) {
  if (!cv) return 0;
  const v = safeParse(cv.value);
  const arr = (v && (v.linkedPulseIds || v.linked_pulse_ids)) || [];
  return Array.isArray(arr) ? arr.length : 0;
}

async function scanBoard(boardId, colIds) {
  const items = [];
  const MAX_PAGES = 60; // 60 * 100 = 6000 items hard cap
  let pages = 0;
  const idsLit = JSON.stringify(colIds);
  let r = await gql(
    `query ($id: [ID!]) {
      boards (ids: $id) {
        items_page (limit: 100) {
          cursor
          items { id column_values (ids: ${idsLit}) { id text value } }
        }
      }
    }`,
    { id: [boardId] }
  );
  if (r.json.errors) return { items, pages, errors: r.json.errors.map((e) => e.message) };
  let page = r.json?.data?.boards?.[0]?.items_page;
  while (page) {
    for (const it of page.items) items.push(it);
    pages++;
    const cursor = page.cursor;
    if (!cursor || pages >= MAX_PAGES) break;
    const r2 = await gql(
      `query ($c: String!) {
        next_items_page (limit: 100, cursor: $c) {
          cursor
          items { id column_values (ids: ${idsLit}) { id text value } }
        }
      }`,
      { c: cursor }
    );
    if (r2.json.errors) { page = null; break; }
    page = r2.json?.data?.next_items_page;
  }
  const truncated = pages >= MAX_PAGES;
  return { items, pages, truncated };
}

function valueOf(item, colId) {
  const cv = (item.column_values || []).find((c) => c.id === colId);
  return cv;
}

function dupGroups(map) {
  // map: normalizedEmail -> [itemIds]; return groups with >1
  const groups = [];
  for (const [k, ids] of map.entries()) {
    if (ids.length > 1) groups.push({ email: maskEmail(k), count: ids.length });
  }
  groups.sort((a, b) => b.count - a.count);
  return groups;
}

async function phaseAudit() {
  const out = { phase: "audit", apiVersion: API_VERSION };

  const cust = await scanBoard(B_CUSTOMERS, [COL_CUST_EMAIL, COL_CUST_EMAIL2, COL_CUST_TO_CONTACTS]);
  const cont = await scanBoard(B_CONTACTS, [COL_CONTACT_EMAIL, COL_CONTACT_TO_CUST]);
  out.scan = {
    customers: { itemsScanned: cust.items.length, pages: cust.pages, truncated: !!cust.truncated, errors: cust.errors },
    contacts: { itemsScanned: cont.items.length, pages: cont.pages, truncated: !!cont.truncated, errors: cont.errors },
  };

  // --- Relationship cardinality ---------------------------------------------
  const contactsPerCustomer = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  let maxContactsOnACustomer = 0;
  for (const it of cust.items) {
    const n = linkedCount(valueOf(it, COL_CUST_TO_CONTACTS));
    maxContactsOnACustomer = Math.max(maxContactsOnACustomer, n);
    contactsPerCustomer[n === 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3+"]++;
  }
  const customersPerContact = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  let maxCustomersOnAContact = 0;
  for (const it of cont.items) {
    const n = linkedCount(valueOf(it, COL_CONTACT_TO_CUST));
    maxCustomersOnAContact = Math.max(maxCustomersOnAContact, n);
    customersPerContact[n === 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3+"]++;
  }
  out.relationship = {
    customerToContacts_distribution: contactsPerCustomer,
    maxContactsOnACustomer,
    contactToCustomers_distribution: customersPerContact,
    maxCustomersOnAContact,
  };

  // --- Email presence + duplicate analysis ----------------------------------
  const custEmailMap = new Map(); // company primary email
  let custEmailPresent = 0, custEmailBlank = 0, custEmailInvalid = 0;
  const invalidRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const it of cust.items) {
    const e = normEmail(valueOf(it, COL_CUST_EMAIL)?.text);
    if (!e) { custEmailBlank++; continue; }
    custEmailPresent++;
    if (!invalidRe.test(e)) custEmailInvalid++;
    if (!custEmailMap.has(e)) custEmailMap.set(e, []);
    custEmailMap.get(e).push(it.id);
  }
  const contEmailMap = new Map();
  let contEmailPresent = 0, contEmailBlank = 0, contEmailInvalid = 0;
  for (const it of cont.items) {
    const e = normEmail(valueOf(it, COL_CONTACT_EMAIL)?.text);
    if (!e) { contEmailBlank++; continue; }
    contEmailPresent++;
    if (!invalidRe.test(e)) contEmailInvalid++;
    if (!contEmailMap.has(e)) contEmailMap.set(e, []);
    contEmailMap.get(e).push(it.id);
  }

  // cross-board overlap
  const crossOverlap = [];
  for (const e of custEmailMap.keys()) {
    if (contEmailMap.has(e)) {
      crossOverlap.push({ email: maskEmail(e), customerItems: custEmailMap.get(e).length, contactItems: contEmailMap.get(e).length });
    }
  }
  crossOverlap.sort((a, b) => (b.customerItems + b.contactItems) - (a.customerItems + a.contactItems));

  out.emailAnalysis = {
    customers_primaryEmail: {
      present: custEmailPresent, blank: custEmailBlank, invalidFormat: custEmailInvalid,
      distinctNormalized: custEmailMap.size,
      withinBoardDuplicateGroups: dupGroups(custEmailMap).length,
      topDuplicateExamples: dupGroups(custEmailMap).slice(0, 5),
    },
    contacts_email: {
      present: contEmailPresent, blank: contEmailBlank, invalidFormat: contEmailInvalid,
      distinctNormalized: contEmailMap.size,
      withinBoardDuplicateGroups: dupGroups(contEmailMap).length,
      topDuplicateExamples: dupGroups(contEmailMap).slice(0, 5),
    },
    crossBoardOverlap: {
      overlappingDistinctEmails: crossOverlap.length,
      examples: crossOverlap.slice(0, 8),
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

// --- Typed-fragment verification of the Company<->Contact relation ----------
async function phaseRel() {
  const out = { phase: "rel", apiVersion: API_VERSION };
  async function probe(boardId, relId, mirrorId) {
    const idsLit = JSON.stringify(mirrorId ? [relId, mirrorId] : [relId]);
    const r = await gql(
      `query ($id: [ID!]) {
        boards (ids: $id) {
          id name
          items_page (limit: 10) {
            items {
              id
              column_values (ids: ${idsLit}) {
                id type text
                ... on BoardRelationValue { linked_item_ids display_value }
                ... on MirrorValue { display_value }
              }
            }
          }
        }
      }`,
      { id: [boardId] }
    );
    if (r.json.errors) return { errors: r.json.errors.map((e) => e.message) };
    const b = r.json?.data?.boards?.[0];
    const items = b?.items_page?.items || [];
    return {
      boardName: b?.name,
      sampled: items.length,
      relPopulatedCount: items.filter((it) => (it.column_values.find((c) => c.id === relId)?.linked_item_ids || []).length > 0).length,
      rows: items.map((it) => {
        const rel = it.column_values.find((c) => c.id === relId);
        const mir = mirrorId ? it.column_values.find((c) => c.id === mirrorId) : null;
        return {
          linkedCount: (rel?.linked_item_ids || []).length,
          relDisplayPresent: !!(rel?.display_value && rel.display_value.trim()),
          mirrorDisplayPresent: mir ? !!(mir.display_value && mir.display_value.trim()) : undefined,
        };
      }),
    };
  }
  out.contacts_relToCustomer = await probe("1903020916", "board_relation_mkpt1ynj", "lookup_mkrkz7vm");
  out.customers_relToContacts = await probe("1903020743", "board_relation_mkpt5a3k", null);
  console.log(JSON.stringify(out, null, 2));
}

// --- Full-set relationship cardinality via typed linked_item_ids ------------
async function scanRelation(boardId, relId) {
  const dist = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  let max = 0, total = 0, pages = 0;
  const MAX_PAGES = 60;
  const sel = `column_values (ids: ["${relId}"]) { id ... on BoardRelationValue { linked_item_ids } }`;
  const tally = (items) => {
    for (const it of items) {
      const cv = it.column_values[0];
      const n = (cv?.linked_item_ids || []).length;
      max = Math.max(max, n);
      dist[n === 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3+"]++;
      total++;
    }
  };
  let r = await gql(`query ($id: [ID!]) { boards (ids: $id) { items_page (limit: 100) { cursor items { id ${sel} } } } }`, { id: [boardId] });
  if (r.json.errors) return { errors: r.json.errors.map((e) => e.message) };
  let page = r.json?.data?.boards?.[0]?.items_page;
  while (page) {
    tally(page.items);
    pages++;
    const c = page.cursor;
    if (!c || pages >= MAX_PAGES) break;
    const r2 = await gql(`query ($c: String!) { next_items_page (limit: 100, cursor: $c) { cursor items { id ${sel} } } }`, { c });
    if (r2.json.errors) break;
    page = r2.json?.data?.next_items_page;
  }
  return { total, dist, max, pages, truncated: pages >= MAX_PAGES };
}

async function phaseCard() {
  const out = { phase: "card", apiVersion: API_VERSION };
  out.customerToContacts = await scanRelation("1903020743", "board_relation_mkpt5a3k");
  out.contactToCustomers = await scanRelation("1903020916", "board_relation_mkpt1ynj");
  console.log(JSON.stringify(out, null, 2));
}

// --- Product board inspection (columns + small masked sample) ---------------
async function inspectBoard(boardId) {
  const meta = await gql(
    `query ($id: [ID!]) {
      boards (ids: $id) {
        id name state board_kind
        workspace { id name }
        items_count
        columns { id title type settings_str }
      }
    }`,
    { id: [boardId] }
  );
  if (meta.json.errors) return { boardId, errors: meta.json.errors.map((e) => e.message) };
  const b = meta.json?.data?.boards?.[0];
  if (!b) return { boardId, note: "board not found / no access" };

  const s = await gql(
    `query ($id: [ID!]) {
      boards (ids: $id) {
        items_page (limit: 8) {
          items {
            id name
            column_values {
              id type text
              ... on BoardRelationValue { linked_item_ids display_value }
              ... on MirrorValue { display_value }
            }
          }
        }
      }
    }`,
    { id: [boardId] }
  );
  const items = s.json?.data?.boards?.[0]?.items_page?.items || [];
  return {
    boardId: b.id,
    boardName: b.name,
    state: b.state,
    board_kind: b.board_kind,
    workspace: b.workspace ? { id: b.workspace.id, name: b.workspace.name } : null,
    itemsCount: b.items_count,
    columnCount: b.columns.length,
    columns: b.columns.map((c) => ({ id: c.id, title: c.title, type: c.type, settings: safeParse(c.settings_str) })),
    sampleErrors: s.json.errors ? s.json.errors.map((e) => e.message) : undefined,
    sample: items.map((it) => ({
      id: it.id,
      name: maskName(it.name),
      values: it.column_values.map((cv) => {
        const base = { id: cv.id, type: cv.type };
        const t = (cv.type || "").toLowerCase();
        if (t.includes("email")) return { ...base, sample: maskEmail(cv.text) };
        if (t.includes("phone")) return { ...base, present: !!cv.text };
        if (t.includes("board_relation") || t.includes("connect")) return { ...base, linkedCount: (cv.linked_item_ids || []).length, display: cv.display_value ? maskName(cv.display_value).slice(0, 30) : "" };
        if (t.includes("mirror")) return { ...base, display: cv.display_value ? cv.display_value.slice(0, 40) : "" };
        if (t === "name" || t === "text" || t === "long_text") return { ...base, present: !!cv.text, sample: maskName(cv.text || "").slice(0, 24) };
        return { ...base, text: cv.text };
      }),
    })),
  };
}

async function phaseProducts() {
  const out = { phase: "products", apiVersion: API_VERSION };
  out.productsBoard = await inspectBoard("1903021552"); // מוצרים (board_relation_mkrydxdp)
  out.customerProductsBoard = await inspectBoard("1903021951"); // מוצרי לקוח (board_relation_mkpr7rp6)
  console.log(JSON.stringify(out, null, 2));
}

const phase = process.argv[2] || "structure";
if (phase === "structure") {
  await phaseStructure();
} else if (phase === "audit") {
  await phaseAudit();
} else if (phase === "rel") {
  await phaseRel();
} else if (phase === "card") {
  await phaseCard();
} else if (phase === "products") {
  await phaseProducts();
} else {
  console.log(JSON.stringify({ fatal: `unknown phase '${phase}'` }));
  process.exit(1);
}
