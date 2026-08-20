import { describe, it, expect } from "vitest";

import {
  classifyItem,
  communicationCandidates,
  toCompanyProjection,
  toContactCrmProjection,
  toCustomerProductProjection,
  toProductProjection,
  type RawMondayItem,
} from "./crmProjection";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_PRODUCT_COLUMNS,
  CONTACT_COLUMNS,
  PRODUCT_COLUMNS,
  MONDAY_BOARDS,
  normalizeCustomerStatus,
  parseMondayDate,
  parseMondayInt,
  parseYesNo,
} from "./mondayColumns";

function item(
  boardId: string,
  itemId: string,
  columns: Record<string, string | null>,
  relations: Record<string, string[]> = {},
  name: string | null = "Item",
): RawMondayItem {
  return { boardId, itemId, name, columns, relations };
}

describe("company projection", () => {
  const raw = () =>
    item(
      MONDAY_BOARDS.CUSTOMERS,
      "111",
      {
        [CUSTOMER_COLUMNS.companyEmail]: "Sales@BigCo.com",
        [CUSTOMER_COLUMNS.accountingEmail]: "books@bigco.com",
        [CUSTOMER_COLUMNS.companyPhone]: "+972-3-1234567",
        [CUSTOMER_COLUMNS.category]: "Surveying",
        [CUSTOMER_COLUMNS.customerStatus]: "פעיל",
        [CUSTOMER_COLUMNS.industry]: "בנייה",
        [CUSTOMER_COLUMNS.classification]: "A",
        [CUSTOMER_COLUMNS.companyNumber]: "514000000",
        [CUSTOMER_COLUMNS.hashavshevetId]: "HS-1",
      },
      { [CUSTOMER_COLUMNS.contactsRelation]: ["901", "902"] },
      "BigCo Ltd",
    );

  it("maps Monday-owned fields", () => {
    const p = toCompanyProjection(raw());
    expect(p.mondayBoardId).toBe(MONDAY_BOARDS.CUSTOMERS);
    expect(p.mondayItemId).toBe("111");
    expect(p.name).toBe("BigCo Ltd");
    expect(p.companyNumber).toBe("514000000");
    expect(p.hashavshevetId).toBe("HS-1");
    expect(p.category).toBe("Surveying");
    expect(p.industryLabel).toBe("בנייה");
    expect(p.classificationLabel).toBe("A");
  });

  it("normalizes the campaign email and keeps the raw value", () => {
    const p = toCompanyProjection(raw());
    expect(p.companyEmail).toBe("Sales@BigCo.com");
    expect(p.companyEmailNorm).toBe("sales@bigco.com");
  });

  it("keeps the accounting email but gives it NO normalized twin", () => {
    const p = toCompanyProjection(raw());
    expect(p.accountingEmail).toBe("books@bigco.com");
    // Structurally impossible to promote into a communication address.
    expect(Object.keys(p)).not.toContain("accountingEmailNorm");
  });

  it("carries linked contact item ids", () => {
    expect(toCompanyProjection(raw()).contactItemIds).toEqual(["901", "902"]);
  });

  it("cannot carry communication state", () => {
    const p = toCompanyProjection(raw());
    for (const forbidden of ["language", "consentStatus", "emailStatus"]) {
      expect(Object.keys(p)).not.toContain(forbidden);
    }
  });

  it("normalizes the status and preserves the raw label", () => {
    const p = toCompanyProjection(raw());
    expect(p.customerStatus).toBe("ACTIVE");
    expect(p.customerStatusRaw).toBe("פעיל");
  });

  it("treats an unrecognised status as UNKNOWN without losing the label", () => {
    const p = toCompanyProjection(
      item(MONDAY_BOARDS.CUSTOMERS, "1", { [CUSTOMER_COLUMNS.customerStatus]: "משהו חדש" }),
    );
    expect(p.customerStatus).toBe("UNKNOWN");
    expect(p.customerStatusRaw).toBe("משהו חדש");
  });

  it("handles a company with no email at all", () => {
    const p = toCompanyProjection(item(MONDAY_BOARDS.CUSTOMERS, "2", {}));
    expect(p.companyEmail).toBeNull();
    expect(p.companyEmailNorm).toBeNull();
  });

  it("leaves an invalid email un-normalized rather than guessing", () => {
    const p = toCompanyProjection(
      item(MONDAY_BOARDS.CUSTOMERS, "3", { [CUSTOMER_COLUMNS.companyEmail]: "not-an-email" }),
    );
    expect(p.companyEmail).toBe("not-an-email");
    expect(p.companyEmailNorm).toBeNull();
  });
});

describe("contact projection", () => {
  const raw = () =>
    item(
      MONDAY_BOARDS.CONTACTS,
      "901",
      {
        [CONTACT_COLUMNS.email]: "Dana@BigCo.com",
        [CONTACT_COLUMNS.phone]: "050-1234567",
        [CONTACT_COLUMNS.jobTitle]: "מנהלת רכש",
        [CONTACT_COLUMNS.address]: "Tel Aviv",
      },
      { [CONTACT_COLUMNS.companyRelation]: ["111", "112"] },
      "דנה כהן",
    );

  it("preserves the full Monday name without splitting it", () => {
    const p = toContactCrmProjection(raw());
    expect(p.fullName).toBe("דנה כהן");
    expect(Object.keys(p)).not.toContain("firstName");
    expect(Object.keys(p)).not.toContain("lastName");
  });

  it("supports a contact linked to several companies", () => {
    expect(toContactCrmProjection(raw()).companyItemIds).toEqual(["111", "112"]);
  });

  it("supports an orphan contact with no company", () => {
    const p = toContactCrmProjection(item(MONDAY_BOARDS.CONTACTS, "902", {}));
    expect(p.companyItemIds).toEqual([]);
  });

  it("cannot carry communication state", () => {
    const p = toContactCrmProjection(raw());
    for (const forbidden of ["language", "consentStatus", "emailStatus"]) {
      expect(Object.keys(p)).not.toContain(forbidden);
    }
  });
});

describe("product and customer-product projections", () => {
  it("maps the catalogue columns", () => {
    const p = toProductProjection(
      item(
        MONDAY_BOARDS.PRODUCTS,
        "500",
        {
          [PRODUCT_COLUMNS.itemKey]: "R980-111-50-01",
          [PRODUCT_COLUMNS.sku]: "MK-1",
          [PRODUCT_COLUMNS.itemType]: "GPS",
          [PRODUCT_COLUMNS.catalogLink]: "https://example.com/r980",
        },
        {},
        "R980 GPS",
      ),
    );
    expect(p.name).toBe("R980 GPS");
    expect(p.itemKey).toBe("R980-111-50-01");
    expect(p.sku).toBe("MK-1");
    expect(p.itemType).toBe("GPS");
    expect(p.catalogLink).toBe("https://example.com/r980");
  });

  it("maps subscription fields and relations", () => {
    const p = toCustomerProductProjection(
      item(
        MONDAY_BOARDS.CUSTOMER_PRODUCTS,
        "700",
        {
          [CUSTOMER_PRODUCT_COLUMNS.status]: "פעיל",
          [CUSTOMER_PRODUCT_COLUMNS.purchaseDate]: "2026-08-10",
          [CUSTOMER_PRODUCT_COLUMNS.subscriptionUntil]: "2027-08-06",
          [CUSTOMER_PRODUCT_COLUMNS.subscriptionLoginId]: "LOGIN-9",
          [CUSTOMER_PRODUCT_COLUMNS.includesCommsPackage]: "כן",
          [CUSTOMER_PRODUCT_COLUMNS.simCount]: "3",
        },
        {
          [CUSTOMER_PRODUCT_COLUMNS.companyRelation]: ["111"],
          [CUSTOMER_PRODUCT_COLUMNS.contactRelation]: ["901"],
          [CUSTOMER_PRODUCT_COLUMNS.productRelation]: ["500"],
        },
      ),
    );

    expect(p.status).toBe("פעיל");
    expect(p.purchaseDate?.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(p.subscriptionUntil?.toISOString().slice(0, 10)).toBe("2027-08-06");
    expect(p.subscriptionLoginId).toBe("LOGIN-9");
    expect(p.includesCommsPackage).toBe(true);
    expect(p.simCount).toBe(3);
    expect(p.companyItemIds).toEqual(["111"]);
    expect(p.contactItemIds).toEqual(["901"]);
    expect(p.productItemIds).toEqual(["500"]);
  });

  it("leaves absent optional values null rather than inventing them", () => {
    const p = toCustomerProductProjection(item(MONDAY_BOARDS.CUSTOMER_PRODUCTS, "701", {}));
    expect(p.purchaseDate).toBeNull();
    expect(p.subscriptionUntil).toBeNull();
    expect(p.simCount).toBeNull();
    expect(p.includesCommsPackage).toBeNull();
  });
});

describe("communication candidates", () => {
  it("offers the company campaign email", () => {
    const p = toCompanyProjection(
      item(MONDAY_BOARDS.CUSTOMERS, "1", { [CUSTOMER_COLUMNS.companyEmail]: "sales@bigco.com" }),
    );
    expect(communicationCandidates(p)).toEqual([
      { normalizedEmail: "sales@bigco.com", source: "COMPANY_EMAIL" },
    ]);
  });

  it("NEVER offers the accounting email", () => {
    const p = toCompanyProjection(
      item(MONDAY_BOARDS.CUSTOMERS, "1", {
        [CUSTOMER_COLUMNS.accountingEmail]: "books@bigco.com",
      }),
    );
    expect(communicationCandidates(p)).toEqual([]);
  });

  it("offers the contact email", () => {
    const p = toContactCrmProjection(
      item(MONDAY_BOARDS.CONTACTS, "9", { [CONTACT_COLUMNS.email]: "dana@bigco.com" }),
    );
    expect(communicationCandidates(p)).toEqual([
      { normalizedEmail: "dana@bigco.com", source: "CONTACT_EMAIL" },
    ]);
  });
});

describe("item classification", () => {
  it.each([
    ["SENDABLE", { name: "BigCo", email: "sales@bigco.com" }],
    ["NO_EMAIL", { name: "BigCo", email: null }],
    ["INVALID_EMAIL", { name: "BigCo", email: "nope" }],
    ["INCOMPLETE", { name: null, email: "sales@bigco.com" }],
  ])("classifies as %s", (expected, input) => {
    const p = toCompanyProjection(
      item(
        MONDAY_BOARDS.CUSTOMERS,
        "1",
        { [CUSTOMER_COLUMNS.companyEmail]: input.email },
        {},
        input.name,
      ),
    );
    expect(classifyItem(p)).toBe(expected);
  });
});

describe("value parsers", () => {
  it("normalizes customer status labels", () => {
    expect(normalizeCustomerStatus("פעיל")).toBe("ACTIVE");
    expect(normalizeCustomerStatus("לא פעיל")).toBe("INACTIVE");
    expect(normalizeCustomerStatus("פוטנציאל")).toBe("POTENTIAL");
    expect(normalizeCustomerStatus("Active")).toBe("ACTIVE");
    expect(normalizeCustomerStatus("")).toBe("UNKNOWN");
    expect(normalizeCustomerStatus(null)).toBe("UNKNOWN");
  });

  it("parses yes/no in Hebrew and English", () => {
    expect(parseYesNo("כן")).toBe(true);
    expect(parseYesNo("לא")).toBe(false);
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("maybe")).toBeNull();
  });

  it("parses dates and integers safely", () => {
    expect(parseMondayDate("2026-08-10")?.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(parseMondayDate("not a date")).toBeNull();
    expect(parseMondayDate("")).toBeNull();
    expect(parseMondayInt("3")).toBe(3);
    expect(parseMondayInt("3.7")).toBe(3);
    expect(parseMondayInt("abc")).toBeNull();
  });
});
