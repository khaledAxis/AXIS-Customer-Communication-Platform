import { Language } from "../types";
import { GroupMatch, SegmentDefinition } from "./segmentDefinition";
import { Operator } from "./segmentFields";

/**
 * Starting points for the segment builder.
 *
 * These are conveniences, NOT business rules: a preset only fills the builder in,
 * and staff edit it freely before saving. Nothing downstream depends on a segment
 * having come from a preset.
 *
 * Lookup conditions (classification, industry, product type) carry the Monday
 * *label*, not a database id — labels are what staff recognise, and an id would
 * change if the lookup row were ever recreated.
 */

export interface SegmentPreset {
  key: string;
  name: string;
  description: string;
  definition: SegmentDefinition;
}

function definition(
  conditions: SegmentDefinition["conditions"],
  groups: SegmentDefinition["groups"] = [],
  include: SegmentDefinition["include"] = {
    companyEmails: true,
    contactEmails: true,
  },
): SegmentDefinition {
  return { version: 1, conditions, groups, include };
}

export const SEGMENT_PRESETS: readonly SegmentPreset[] = [
  {
    key: "gps-customers",
    name: "GPS customers",
    description: "Every customer classified as GPS in Monday.",
    definition: definition([
      { field: "company.classification", operator: Operator.IS, value: "GPS" },
    ]),
  },
  {
    key: "scanner-customers",
    name: "Scanner customers",
    description: "Every customer classified as scanner in Monday.",
    definition: definition([
      { field: "company.classification", operator: Operator.IS, value: "scanner" },
    ]),
  },
  {
    key: "trimble-installed-base",
    name: "Trimble installed base",
    description: "Customers who own at least one Trimble product.",
    definition: definition([
      { field: "product.name", operator: Operator.OWNS, value: "Trimble" },
    ]),
  },
  {
    key: "subscription-renewals",
    name: "Subscription renewals (next 90 days)",
    description: "Customers with a subscription expiring soon.",
    definition: definition([
      {
        field: "customerProduct.subscriptionUntil",
        operator: Operator.WITHIN_NEXT_DAYS,
        days: 90,
      },
    ]),
  },
  {
    key: "expired-subscriptions",
    name: "Expired subscriptions",
    description: "Customers whose subscription has already lapsed.",
    definition: definition([
      { field: "customerProduct.subscriptionUntil", operator: Operator.EXPIRED },
    ]),
  },
  {
    key: "hebrew-audience",
    name: "Hebrew newsletter audience",
    description:
      "Addresses marked as Hebrew. Addresses with no language set are excluded from a Hebrew send.",
    definition: definition([
      { field: "communication.language", operator: Operator.IS, value: Language.HE },
    ]),
  },
  {
    key: "arabic-audience",
    name: "Arabic newsletter audience",
    description:
      "Addresses marked as Arabic. Addresses with no language set are excluded from an Arabic send.",
    definition: definition([
      { field: "communication.language", operator: Operator.IS, value: Language.AR },
    ]),
  },
  {
    key: "active-with-email",
    name: "Active customers with an email address",
    description: "Active companies that have a newsletter address on file.",
    definition: definition([
      { field: "company.status", operator: Operator.IS, value: "ACTIVE" },
      { field: "company.email", operator: Operator.IS_NOT_EMPTY },
    ]),
  },
  {
    key: "gps-trimble-example",
    name: "GPS customers owning Trimble Access or Business Center",
    description:
      "Shows how a group works: all of the first conditions, plus any one of the products.",
    definition: definition(
      [{ field: "company.classification", operator: Operator.IS, value: "GPS" }],
      [
        {
          match: GroupMatch.ANY,
          conditions: [
            { field: "product.name", operator: Operator.OWNS, value: "Trimble Access" },
            {
              field: "product.name",
              operator: Operator.OWNS,
              value: "Trimble Business Center",
            },
          ],
        },
      ],
    ),
  },
];

export function findPreset(key: string): SegmentPreset | undefined {
  return SEGMENT_PRESETS.find((p) => p.key === key);
}
