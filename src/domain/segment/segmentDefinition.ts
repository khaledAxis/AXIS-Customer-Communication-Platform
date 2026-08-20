import {
  FieldScope,
  Operator,
  ValueKind,
  findField,
  operatorTakesList,
  operatorTakesNoValue,
  OPERATOR_LABEL,
} from "./segmentFields";

/**
 * The saved shape of a segment, and the parser that turns untrusted JSON into it.
 *
 * A segment stores *rules*, never SQL and never executable code (ADR-0018). The
 * stored JSON is re-validated on every read, because a row written by an older
 * version of the app — or edited by hand — is untrusted input like any other.
 *
 * v1 boolean shape, deliberately limited so the builder stays understandable:
 *
 *   ALL of:
 *     - condition
 *     - condition
 *     - group  (ANY / ALL of conditions that all share one scope)
 *     - group
 *
 * One level of nesting. Arbitrary nested boolean expressions are NOT supported;
 * the constraint is enforced here rather than left to the UI.
 */

export const GroupMatch = { ALL: "ALL", ANY: "ANY" } as const;
export type GroupMatch = (typeof GroupMatch)[keyof typeof GroupMatch];

export interface SegmentCondition {
  field: string;
  operator: Operator;
  /** Single value (text, enum member, lookup id, ISO date). */
  value?: string;
  /** Value list, for IS_ONE_OF. */
  values?: string[];
  /** Day count, for WITHIN_NEXT_DAYS. */
  days?: number;
}

export interface SegmentGroup {
  match: GroupMatch;
  conditions: SegmentCondition[];
}

export interface SegmentInclude {
  /** Include each matching company's own newsletter address. */
  companyEmails: boolean;
  /** Include the addresses of matching contacts. */
  contactEmails: boolean;
}

export interface SegmentDefinition {
  version: 1;
  /** Combined with AND, together with every group. */
  conditions: SegmentCondition[];
  groups: SegmentGroup[];
  include: SegmentInclude;
}

export interface SegmentIssue {
  path: string;
  message: string;
}

export class SegmentDefinitionError extends Error {
  readonly issues: SegmentIssue[];

  constructor(issues: SegmentIssue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "SegmentDefinitionError";
    this.issues = issues;
  }
}

/** Caps that keep the builder readable and the generated query bounded. */
export const MAX_CONDITIONS = 40;
export const MAX_GROUPS = 8;
export const MAX_GROUP_CONDITIONS = 20;
export const MAX_VALUE_LENGTH = 200;
export const MAX_LIST_VALUES = 50;
export const MAX_DAYS = 3650;

export function emptySegmentDefinition(): SegmentDefinition {
  return {
    version: 1,
    conditions: [],
    groups: [],
    include: { companyEmails: true, contactEmails: true },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCondition(
  raw: unknown,
  path: string,
  issues: SegmentIssue[],
): SegmentCondition | null {
  if (!isRecord(raw)) {
    issues.push({ path, message: "This condition is not readable." });
    return null;
  }

  const fieldKey = typeof raw.field === "string" ? raw.field : "";
  const field = findField(fieldKey);
  if (!field) {
    issues.push({
      path,
      message: fieldKey
        ? `"${fieldKey}" is not a field you can filter on.`
        : "Choose a field for this condition.",
    });
    return null;
  }

  const operator = raw.operator as Operator;
  if (typeof operator !== "string" || !field.operators.includes(operator)) {
    issues.push({
      path,
      message: `"${String(raw.operator)}" is not a valid condition for ${field.label}.`,
    });
    return null;
  }

  const condition: SegmentCondition = { field: field.key, operator };

  // ---- value shape, driven by the operator ------------------------------
  if (operatorTakesNoValue(operator)) {
    return condition;
  }

  if (operator === Operator.WITHIN_NEXT_DAYS) {
    const days =
      typeof raw.days === "number"
        ? raw.days
        : typeof raw.value === "string"
          ? Number(raw.value)
          : Number.NaN;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      issues.push({
        path,
        message: `Enter a number of days between 1 and ${MAX_DAYS} for ${field.label}.`,
      });
      return null;
    }
    condition.days = days;
    return condition;
  }

  if (operatorTakesList(operator)) {
    const values = Array.isArray(raw.values) ? raw.values : [];
    const cleaned = values
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= MAX_VALUE_LENGTH);
    if (cleaned.length === 0) {
      issues.push({ path, message: `Choose at least one value for ${field.label}.` });
      return null;
    }
    if (cleaned.length > MAX_LIST_VALUES) {
      issues.push({
        path,
        message: `${field.label} accepts at most ${MAX_LIST_VALUES} values.`,
      });
      return null;
    }
    if (!validateChoices(field.valueKind, field.choices, cleaned, path, field.label, issues)) {
      return null;
    }
    condition.values = cleaned;
    return condition;
  }

  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (value.length === 0) {
    issues.push({ path, message: `Enter a value for ${field.label}.` });
    return null;
  }
  if (value.length > MAX_VALUE_LENGTH) {
    issues.push({
      path,
      message: `The value for ${field.label} is too long.`,
    });
    return null;
  }
  if (field.valueKind === ValueKind.DATE && Number.isNaN(Date.parse(value))) {
    issues.push({ path, message: `Choose a valid date for ${field.label}.` });
    return null;
  }
  if (!validateChoices(field.valueKind, field.choices, [value], path, field.label, issues)) {
    return null;
  }

  condition.value = value;
  return condition;
}

/** ENUM fields accept only values declared in the catalogue. LOOKUP ids are free-form. */
function validateChoices(
  valueKind: ValueKind,
  choices: readonly { value: string; label: string }[] | undefined,
  values: string[],
  path: string,
  label: string,
  issues: SegmentIssue[],
): boolean {
  if (valueKind !== ValueKind.ENUM || !choices) return true;
  const allowed = new Set(choices.map((c) => c.value));
  const bad = values.find((v) => !allowed.has(v));
  if (bad !== undefined) {
    issues.push({ path, message: `"${bad}" is not a valid choice for ${label}.` });
    return false;
  }
  return true;
}

function scopeOf(condition: SegmentCondition): FieldScope | null {
  return findField(condition.field)?.scope ?? null;
}

/**
 * Parses and validates untrusted JSON into a definition.
 *
 * Throws `SegmentDefinitionError` with per-condition issues — the UI shows them
 * next to the offending row rather than as one opaque failure.
 */
export function parseSegmentDefinition(raw: unknown): SegmentDefinition {
  const issues: SegmentIssue[] = [];

  if (!isRecord(raw)) {
    throw new SegmentDefinitionError([
      { path: "segment", message: "This segment could not be read." },
    ]);
  }

  if (raw.version !== 1) {
    throw new SegmentDefinitionError([
      {
        path: "version",
        message: "This segment was saved by a different version of the app.",
      },
    ]);
  }

  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];

  const conditions: SegmentCondition[] = [];
  rawConditions.forEach((c, i) => {
    const parsed = parseCondition(c, `conditions.${i}`, issues);
    if (parsed) conditions.push(parsed);
  });

  if (rawGroups.length > MAX_GROUPS) {
    issues.push({
      path: "groups",
      message: `A segment can have at most ${MAX_GROUPS} groups.`,
    });
  }

  const groups: SegmentGroup[] = [];
  rawGroups.slice(0, MAX_GROUPS).forEach((g, gi) => {
    const path = `groups.${gi}`;
    if (!isRecord(g)) {
      issues.push({ path, message: "This group is not readable." });
      return;
    }
    const match = g.match === GroupMatch.ANY ? GroupMatch.ANY : GroupMatch.ALL;
    if (g.match !== GroupMatch.ANY && g.match !== GroupMatch.ALL) {
      issues.push({ path, message: "A group must match ANY or ALL of its conditions." });
      return;
    }

    const list = Array.isArray(g.conditions) ? g.conditions : [];
    if (list.length === 0) {
      issues.push({ path, message: "This group has no conditions." });
      return;
    }
    if (list.length > MAX_GROUP_CONDITIONS) {
      issues.push({
        path,
        message: `A group can have at most ${MAX_GROUP_CONDITIONS} conditions.`,
      });
      return;
    }

    const parsed: SegmentCondition[] = [];
    list.forEach((c, ci) => {
      const one = parseCondition(c, `${path}.conditions.${ci}`, issues);
      if (one) parsed.push(one);
    });
    if (parsed.length !== list.length) return;

    // v1 constraint: a group cannot mix scopes. "ANY of [company X, contact Y]"
    // has no single clear meaning once a company can have many contacts, so it is
    // refused rather than silently reinterpreted.
    const scopes = new Set(parsed.map(scopeOf));
    if (scopes.size > 1) {
      issues.push({
        path,
        message:
          "All conditions in one group must be about the same thing — company, contact, products, or email settings.",
      });
      return;
    }

    groups.push({ match, conditions: parsed });
  });

  const totalConditions =
    conditions.length + groups.reduce((sum, g) => sum + g.conditions.length, 0);
  if (totalConditions > MAX_CONDITIONS) {
    issues.push({
      path: "conditions",
      message: `A segment can have at most ${MAX_CONDITIONS} conditions.`,
    });
  }

  const includeRaw = isRecord(raw.include) ? raw.include : {};
  const include: SegmentInclude = {
    companyEmails: includeRaw.companyEmails !== false,
    contactEmails: includeRaw.contactEmails !== false,
  };
  if (!include.companyEmails && !include.contactEmails) {
    issues.push({
      path: "include",
      message: "Choose at least one kind of address to include.",
    });
  }

  if (issues.length > 0) throw new SegmentDefinitionError(issues);

  return { version: 1, conditions, groups, include };
}

/** True when the definition selects everything (no conditions at all). */
export function isUnfiltered(definition: SegmentDefinition): boolean {
  return definition.conditions.length === 0 && definition.groups.length === 0;
}

/**
 * A short human sentence for one condition, used in summaries and previews.
 * Enum values are shown by their friendly label — staff never see `HE`.
 */
export function describeCondition(condition: SegmentCondition): string {
  const field = findField(condition.field);
  const label = field?.label ?? condition.field;
  const op = OPERATOR_LABEL[condition.operator] ?? condition.operator;

  const readable = (value: string): string =>
    field?.choices?.find((choice) => choice.value === value)?.label ?? value;

  if (operatorTakesNoValue(condition.operator)) return `${label} ${op}`;
  if (condition.operator === Operator.WITHIN_NEXT_DAYS) {
    return `${label} ${op} ${condition.days} days`;
  }
  if (condition.values) {
    return `${label} ${op} ${condition.values.map(readable).join(", ")}`;
  }
  return `${label} ${op} ${readable(condition.value ?? "")}`.trim();
}
