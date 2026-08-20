import { describe, it, expect } from "vitest";

import {
  GroupMatch,
  MAX_CONDITIONS,
  SegmentDefinitionError,
  describeCondition,
  emptySegmentDefinition,
  isUnfiltered,
  parseSegmentDefinition,
} from "./segmentDefinition";
import { Operator, SEGMENT_FIELDS, findField } from "./segmentFields";

/**
 * Stored segment rules are untrusted input: a row can be older than the code, or
 * hand-edited. Everything here is about what the parser REFUSES.
 */

const base = {
  version: 1,
  conditions: [],
  groups: [],
  include: { companyEmails: true, contactEmails: true },
};

const definition = (patch: Record<string, unknown>) => ({ ...base, ...patch });

describe("segment definition validation", () => {
  it("accepts a minimal empty definition", () => {
    const parsed = parseSegmentDefinition(base);
    expect(parsed.version).toBe(1);
    expect(isUnfiltered(parsed)).toBe(true);
  });

  it("accepts the shape produced by emptySegmentDefinition()", () => {
    expect(() => parseSegmentDefinition(emptySegmentDefinition())).not.toThrow();
  });

  it("rejects a definition that is not an object", () => {
    expect(() => parseSegmentDefinition("classification = GPS")).toThrow(
      SegmentDefinitionError,
    );
    expect(() => parseSegmentDefinition(null)).toThrow(SegmentDefinitionError);
    expect(() => parseSegmentDefinition([])).toThrow(SegmentDefinitionError);
  });

  it("rejects an unknown version", () => {
    expect(() => parseSegmentDefinition({ ...base, version: 2 })).toThrow(
      /different version/i,
    );
  });

  it("rejects an unknown field", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.secretColumn", operator: Operator.IS, value: "x" },
          ],
        }),
      ),
    ).toThrow(/not a field you can filter on/i);
  });

  it("rejects an operator the field does not support", () => {
    // A status is an enum: "starts with" is meaningless for it.
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.status", operator: Operator.STARTS_WITH, value: "AC" },
          ],
        }),
      ),
    ).toThrow(/not a valid condition/i);
  });

  it("rejects an invented operator", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.name", operator: "DROP_TABLE", value: "x" },
          ],
        }),
      ),
    ).toThrow(SegmentDefinitionError);
  });

  it("rejects an enum value outside the catalogue", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.status", operator: Operator.IS, value: "PROSPECT" },
          ],
        }),
      ),
    ).toThrow(/not a valid choice/i);
  });

  it("rejects a missing value where one is required", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [{ field: "company.name", operator: Operator.CONTAINS }],
        }),
      ),
    ).toThrow(/enter a value/i);
  });

  it("keeps operators that carry their own meaning valueless", () => {
    const parsed = parseSegmentDefinition(
      definition({
        conditions: [
          { field: "company.email", operator: Operator.IS_NOT_EMPTY, value: "ignored" },
        ],
      }),
    );
    expect(parsed.conditions[0].value).toBeUndefined();
  });

  it("rejects a day count that is not a positive whole number", () => {
    const bad = (days: unknown) =>
      parseSegmentDefinition(
        definition({
          conditions: [
            {
              field: "customerProduct.subscriptionUntil",
              operator: Operator.WITHIN_NEXT_DAYS,
              days,
            },
          ],
        }),
      );
    expect(() => bad(0)).toThrow(/number of days/i);
    expect(() => bad(-5)).toThrow(/number of days/i);
    expect(() => bad(1.5)).toThrow(/number of days/i);
    expect(() => bad("soon")).toThrow(/number of days/i);
    expect(() => bad(999_999)).toThrow(/number of days/i);
  });

  it("accepts a day count given as a numeric string", () => {
    const parsed = parseSegmentDefinition(
      definition({
        conditions: [
          {
            field: "customerProduct.subscriptionUntil",
            operator: Operator.WITHIN_NEXT_DAYS,
            value: "90",
          },
        ],
      }),
    );
    expect(parsed.conditions[0].days).toBe(90);
  });

  it("rejects an unreadable date", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            {
              field: "customerProduct.subscriptionUntil",
              operator: Operator.BEFORE,
              value: "next tuesday",
            },
          ],
        }),
      ),
    ).toThrow(/valid date/i);
  });

  it("rejects an empty list for is-one-of", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.status", operator: Operator.IS_ONE_OF, values: [] },
          ],
        }),
      ),
    ).toThrow(/at least one value/i);
  });

  it("rejects an over-long value", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "company.name", operator: Operator.CONTAINS, value: "x".repeat(500) },
          ],
        }),
      ),
    ).toThrow(/too long/i);
  });

  it("rejects a group that mixes scopes", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          groups: [
            {
              match: GroupMatch.ANY,
              conditions: [
                { field: "company.name", operator: Operator.CONTAINS, value: "a" },
                { field: "contact.jobTitle", operator: Operator.CONTAINS, value: "b" },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/same thing/i);
  });

  it("rejects an empty group", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({ groups: [{ match: GroupMatch.ANY, conditions: [] }] }),
      ),
    ).toThrow(/no conditions/i);
  });

  it("rejects an unknown group combinator", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({
          groups: [
            {
              match: "NONE_OF",
              conditions: [
                { field: "company.name", operator: Operator.CONTAINS, value: "a" },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/ANY or ALL/i);
  });

  it("rejects a segment with no address kind selected", () => {
    expect(() =>
      parseSegmentDefinition(
        definition({ include: { companyEmails: false, contactEmails: false } }),
      ),
    ).toThrow(/at least one kind of address/i);
  });

  it("rejects more conditions than the cap", () => {
    const many = Array.from({ length: MAX_CONDITIONS + 1 }, () => ({
      field: "company.name",
      operator: Operator.CONTAINS,
      value: "a",
    }));
    expect(() => parseSegmentDefinition(definition({ conditions: many }))).toThrow(
      /at most/i,
    );
  });

  it("reports one issue per offending condition", () => {
    try {
      parseSegmentDefinition(
        definition({
          conditions: [
            { field: "nope.one", operator: Operator.IS, value: "x" },
            { field: "nope.two", operator: Operator.IS, value: "x" },
          ],
        }),
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentDefinitionError);
      expect((error as SegmentDefinitionError).issues).toHaveLength(2);
    }
  });

  it("round-trips a valid definition unchanged", () => {
    const input = definition({
      conditions: [
        { field: "company.classification", operator: Operator.IS, value: "GPS" },
      ],
      groups: [
        {
          match: GroupMatch.ANY,
          conditions: [
            { field: "product.name", operator: Operator.OWNS, value: "Trimble R12i" },
            { field: "product.name", operator: Operator.OWNS, value: "Trimble R980" },
          ],
        },
      ],
    });
    const parsed = parseSegmentDefinition(input);
    expect(parseSegmentDefinition(parsed)).toEqual(parsed);
  });

  it("drops unexpected extra keys rather than storing them", () => {
    const parsed = parseSegmentDefinition(
      definition({
        conditions: [
          {
            field: "company.name",
            operator: Operator.CONTAINS,
            value: "axis",
            sql: "; drop table Company;",
          },
        ],
      }),
    );
    expect(parsed.conditions[0]).toEqual({
      field: "company.name",
      operator: Operator.CONTAINS,
      value: "axis",
    });
  });
});

describe("field catalogue", () => {
  it("every field declares at least one operator it supports", () => {
    for (const field of SEGMENT_FIELDS) {
      expect(field.operators.length).toBeGreaterThan(0);
    }
  });

  it("field keys are unique", () => {
    const keys = SEGMENT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes no Monday column id or database id", () => {
    // Naming Monday is fine — staff use it. Leaking a column id is not.
    for (const field of SEGMENT_FIELDS) {
      expect(field.label).not.toMatch(/color_|text_|dropdown_|numeric_/i);
      expect(field.key).not.toMatch(/mkpr|mm1gz|[0-9]{6,}/);
      expect(field.hint ?? "").not.toMatch(/color_|text_|[0-9]{6,}/i);
    }
  });

  it("has no field that would expose the accounting address", () => {
    for (const field of SEGMENT_FIELDS) {
      expect(field.key.toLowerCase()).not.toContain("accounting");
      expect(field.label.toLowerCase()).not.toContain("accounting");
    }
  });

  it("describes a condition in plain language", () => {
    expect(
      describeCondition({
        field: "company.classification",
        operator: Operator.IS,
        value: "GPS",
      }),
    ).toBe("Customer classification is GPS");

    expect(
      describeCondition({
        field: "customerProduct.subscriptionUntil",
        operator: Operator.WITHIN_NEXT_DAYS,
        days: 90,
      }),
    ).toBe("Subscription expiry expires within the next 90 days");
  });

  it("shows enum values by their friendly label, never the code", () => {
    expect(
      describeCondition({
        field: "communication.language",
        operator: Operator.IS,
        value: "HE",
      }),
    ).toBe("Language is Hebrew");

    expect(
      describeCondition({
        field: "company.status",
        operator: Operator.IS_ONE_OF,
        values: ["ACTIVE", "POTENTIAL"],
      }),
    ).toBe("Customer status is one of Active, Potential");
  });

  it("marks sparsely-populated fields honestly instead of hiding them", () => {
    expect(findField("company.industry")?.coverageNote).toBeTruthy();
    expect(findField("communication.language")?.coverageNote).toBeTruthy();
  });
});
