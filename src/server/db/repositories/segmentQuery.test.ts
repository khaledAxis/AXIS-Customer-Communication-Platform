import { describe, it, expect } from "vitest";

import {
  GroupMatch,
  SegmentDefinition,
  parseSegmentDefinition,
} from "../../../domain/segment/segmentDefinition";
import { Operator } from "../../../domain/segment/segmentFields";
import { ConsentStatus, EmailStatus, Language } from "../../../domain/types";

import {
  AddressFacts,
  buildCompanyWhere,
  buildContactWhere,
  hasCommunicationConstraint,
  hasCompanyConstraint,
  matchesCommunication,
} from "./segmentQuery";

/**
 * The translator is pure: rules in, Prisma filter objects out. Testing the
 * generated shape catches an operator mapped to the wrong column without
 * needing a database.
 */

const NOW = new Date("2026-08-18T00:00:00.000Z");

function def(patch: Partial<SegmentDefinition>): SegmentDefinition {
  return parseSegmentDefinition({
    version: 1,
    conditions: [],
    groups: [],
    include: { companyEmails: true, contactEmails: true },
    ...patch,
  });
}

const facts = (patch: Partial<AddressFacts> = {}): AddressFacts => ({
  language: Language.UNKNOWN,
  consentStatus: ConsentStatus.UNKNOWN,
  emailStatus: EmailStatus.UNKNOWN,
  isUnsubscribed: false,
  isSuppressed: false,
  ...patch,
});

describe("company filters", () => {
  it("returns no filter for an unfiltered segment", () => {
    expect(buildCompanyWhere(def({}), NOW)).toBeUndefined();
    expect(hasCompanyConstraint(def({}))).toBe(false);
  });

  it("maps status to the enum column", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "company.status", operator: Operator.IS, value: "ACTIVE" },
        ],
      }),
      NOW,
    );
    expect(where).toEqual({ AND: [{ customerStatus: "ACTIVE" }] });
  });

  it("maps a lookup field to the label, not a database id", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "company.classification", operator: Operator.IS, value: "GPS" },
        ],
      }),
      NOW,
    );
    expect(where).toEqual({
      AND: [{ classification: { label: { equals: "GPS", mode: "insensitive" } } }],
    });
  });

  it("treats an empty string as empty, not as a value", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [{ field: "company.category", operator: Operator.IS_EMPTY }],
      }),
      NOW,
    );
    expect(where).toEqual({
      AND: [{ OR: [{ category: null }, { category: "" }] }],
    });
  });

  it("combines top-level conditions with AND", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "company.classification", operator: Operator.IS, value: "GPS" },
          { field: "company.status", operator: Operator.IS, value: "ACTIVE" },
        ],
      }),
      NOW,
    );
    expect(where?.AND).toHaveLength(2);
  });

  it("turns an ANY group into OR", () => {
    const where = buildCompanyWhere(
      def({
        groups: [
          {
            match: GroupMatch.ANY,
            conditions: [
              { field: "company.category", operator: Operator.CONTAINS, value: "GPS" },
              { field: "company.category", operator: Operator.CONTAINS, value: "scan" },
            ],
          },
        ],
      }),
      NOW,
    );
    const clause = (where?.AND as Record<string, unknown>[])[0];
    expect(Object.keys(clause)).toEqual(["OR"]);
    expect((clause.OR as unknown[]).length).toBe(2);
  });

  it("turns an ALL group into AND", () => {
    const where = buildCompanyWhere(
      def({
        groups: [
          {
            match: GroupMatch.ALL,
            conditions: [
              { field: "company.category", operator: Operator.CONTAINS, value: "GPS" },
              { field: "company.name", operator: Operator.STARTS_WITH, value: "A" },
            ],
          },
        ],
      }),
      NOW,
    );
    const clause = (where?.AND as Record<string, unknown>[])[0];
    expect(Object.keys(clause)).toEqual(["AND"]);
  });
});

describe("product filters", () => {
  it("owning a product becomes a `some` clause on owned products", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "product.name", operator: Operator.OWNS, value: "Trimble" },
        ],
      }),
      NOW,
    );
    expect(where).toEqual({
      AND: [
        {
          ownedProducts: {
            some: {
              AND: [
                { product: { name: { contains: "Trimble", mode: "insensitive" } } },
              ],
            },
          },
        },
      ],
    });
  });

  it("not owning a product becomes a `none` clause", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "product.name", operator: Operator.DOES_NOT_OWN, value: "Trimble" },
        ],
      }),
      NOW,
    );
    expect(where).toEqual({
      AND: [
        {
          ownedProducts: {
            none: { product: { name: { contains: "Trimble", mode: "insensitive" } } },
          },
        },
      ],
    });
  });

  it("AND-ed product conditions must be satisfied by ONE owned product", () => {
    // "a Trimble subscription expiring soon" — not "a Trimble, and separately
    // something expiring soon".
    const where = buildCompanyWhere(
      def({
        conditions: [
          { field: "product.name", operator: Operator.OWNS, value: "Trimble" },
          {
            field: "customerProduct.subscriptionUntil",
            operator: Operator.WITHIN_NEXT_DAYS,
            days: 90,
          },
        ],
      }),
      NOW,
    );
    const clauses = where?.AND as Record<string, { some?: { AND: unknown[] } }>[];
    expect(clauses).toHaveLength(1);
    expect(clauses[0].ownedProducts.some?.AND).toHaveLength(2);
  });

  it("an ANY product group allows different products to satisfy each branch", () => {
    const where = buildCompanyWhere(
      def({
        groups: [
          {
            match: GroupMatch.ANY,
            conditions: [
              { field: "product.name", operator: Operator.OWNS, value: "R12i" },
              { field: "product.name", operator: Operator.OWNS, value: "R980" },
            ],
          },
        ],
      }),
      NOW,
    );
    const clause = (where?.AND as Record<string, unknown[]>[])[0];
    expect(clause.OR).toHaveLength(2);
  });

  it("expiry windows are calculated from the supplied clock", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          {
            field: "customerProduct.subscriptionUntil",
            operator: Operator.WITHIN_NEXT_DAYS,
            days: 10,
          },
        ],
      }),
      NOW,
    );
    const filter = (
      where?.AND as Record<string, { some: { AND: { subscriptionUntil: { gte: Date; lte: Date } }[] } }>[]
    )[0].ownedProducts.some.AND[0].subscriptionUntil;
    expect(filter.gte).toEqual(NOW);
    expect(filter.lte).toEqual(new Date("2026-08-28T00:00:00.000Z"));
  });

  it("expired means strictly before now", () => {
    const where = buildCompanyWhere(
      def({
        conditions: [
          {
            field: "customerProduct.subscriptionUntil",
            operator: Operator.EXPIRED,
          },
        ],
      }),
      NOW,
    );
    const filter = (
      where?.AND as Record<string, { some: { AND: { subscriptionUntil: { lt: Date } }[] } }>[]
    )[0].ownedProducts.some.AND[0].subscriptionUntil;
    expect(filter.lt).toEqual(NOW);
  });

  it("product conditions count as a company constraint", () => {
    expect(
      hasCompanyConstraint(
        def({
          conditions: [
            { field: "product.name", operator: Operator.OWNS, value: "Trimble" },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("contact filters", () => {
  it("maps job title to the contact column", () => {
    const where = buildContactWhere(
      def({
        conditions: [
          { field: "contact.jobTitle", operator: Operator.CONTAINS, value: "מנהל" },
        ],
      }),
    );
    expect(where).toEqual({
      AND: [{ jobTitle: { contains: "מנהל", mode: "insensitive" } }],
    });
  });

  it("linked-to-a-company maps to the join table", () => {
    expect(
      buildContactWhere(
        def({
          conditions: [
            { field: "contact.hasCompany", operator: Operator.IS_NO },
          ],
        }),
      ),
    ).toEqual({ AND: [{ companyLinks: { none: {} } }] });
  });

  it("ignores company conditions", () => {
    expect(
      buildContactWhere(
        def({
          conditions: [
            { field: "company.status", operator: Operator.IS, value: "ACTIVE" },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("email-settings matching", () => {
  const hebrew = def({
    conditions: [
      { field: "communication.language", operator: Operator.IS, value: Language.HE },
    ],
  });

  it("is detected as a communication constraint", () => {
    expect(hasCommunicationConstraint(hebrew)).toBe(true);
    expect(hasCommunicationConstraint(def({}))).toBe(false);
  });

  it("matches on the address language, never on a name", () => {
    expect(matchesCommunication(hebrew, facts({ language: Language.HE }))).toBe(true);
    expect(matchesCommunication(hebrew, facts({ language: Language.AR }))).toBe(false);
    expect(matchesCommunication(hebrew, facts({ language: Language.UNKNOWN }))).toBe(
      false,
    );
  });

  it("supports is-one-of across enum values", () => {
    const either = def({
      conditions: [
        {
          field: "communication.language",
          operator: Operator.IS_ONE_OF,
          values: [Language.HE, Language.AR],
        },
      ],
    });
    expect(matchesCommunication(either, facts({ language: Language.AR }))).toBe(true);
    expect(matchesCommunication(either, facts({ language: Language.UNKNOWN }))).toBe(
      false,
    );
  });

  it("matches unsubscribed and blocked state", () => {
    const notUnsubscribed = def({
      conditions: [
        { field: "communication.unsubscribed", operator: Operator.IS_NO },
      ],
    });
    expect(matchesCommunication(notUnsubscribed, facts())).toBe(true);
    expect(
      matchesCommunication(notUnsubscribed, facts({ isUnsubscribed: true })),
    ).toBe(false);
  });

  it("applies an ANY group over email settings", () => {
    const anyOf = def({
      groups: [
        {
          match: GroupMatch.ANY,
          conditions: [
            { field: "communication.consent", operator: Operator.IS, value: "GRANTED" },
            {
              field: "communication.emailStatus",
              operator: Operator.IS,
              value: "VALID",
            },
          ],
        },
      ],
    });
    expect(matchesCommunication(anyOf, facts({ emailStatus: EmailStatus.VALID }))).toBe(
      true,
    );
    expect(matchesCommunication(anyOf, facts())).toBe(false);
  });
});
