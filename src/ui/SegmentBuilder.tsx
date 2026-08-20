"use client";

import { useActionState, useMemo, useState } from "react";

import type {
  PreviewState,
  SegmentFormState,
} from "../app/segments/actions";
import {
  GroupMatch,
  SegmentCondition,
  SegmentDefinition,
  SegmentGroup,
  describeCondition,
} from "../domain/segment/segmentDefinition";
import {
  FieldScope,
  Operator,
  OPERATOR_LABEL,
  SCOPE_LABEL,
  SEGMENT_FIELDS,
  ValueKind,
  findField,
  operatorTakesList,
  operatorTakesNoValue,
} from "../domain/segment/segmentFields";
import type { LookupOptions } from "../server/services/segmentService";
import { AudiencePreviewPanel } from "./AudiencePreviewPanel";
import { LANGUAGE_LABEL } from "./labels";
import {
  Card,
  ErrorSummary,
  Field,
  buttonPrimary,
  buttonSecondary,
  buttonSubtle,
  inputClass,
} from "./primitives";

/**
 * The condition builder.
 *
 * Staff pick a field, a condition, and a value — never JSON, SQL, an enum name,
 * a Monday column, or a database id. The rules are serialized into a hidden
 * field on submit; the server re-validates them regardless (CLAUDE.md).
 */

type SaveAction = (
  state: SegmentFormState,
  formData: FormData,
) => Promise<SegmentFormState>;
type PreviewAction = (
  state: PreviewState,
  formData: FormData,
) => Promise<PreviewState>;

const SCOPES: FieldScope[] = [
  FieldScope.COMPANY,
  FieldScope.PRODUCT,
  FieldScope.CONTACT,
  FieldScope.COMMUNICATION,
];

const selectClass = inputClass;

function optionsFor(
  key: string,
  lookups: LookupOptions,
): { value: string; label: string }[] {
  const field = findField(key);
  if (!field) return [];
  if (field.valueKind === ValueKind.ENUM) return [...(field.choices ?? [])];
  if (field.valueKind !== ValueKind.LOOKUP) return [];

  const list =
    field.lookup === "CLASSIFICATION"
      ? lookups.classifications
      : field.lookup === "INDUSTRY"
        ? lookups.industries
        : lookups.productTypes;

  return list.map((item) => ({
    value: item.value,
    label: `${item.label} (${item.count.toLocaleString()})`,
  }));
}

function defaultCondition(): SegmentCondition {
  return {
    field: "company.classification",
    operator: Operator.IS,
    value: "",
  };
}

function ConditionRow({
  condition,
  lookups,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition;
  lookups: LookupOptions;
  onChange: (next: SegmentCondition) => void;
  onRemove: () => void;
}) {
  const field = findField(condition.field);
  const choices = optionsFor(condition.field, lookups);
  const noValue = operatorTakesNoValue(condition.operator);
  const isList = operatorTakesList(condition.operator);

  const changeField = (key: string) => {
    const next = findField(key);
    onChange({
      field: key,
      operator: next?.operators[0] ?? Operator.IS,
      value: "",
    });
  };

  const changeOperator = (operator: Operator) => {
    onChange({ field: condition.field, operator, value: "", values: [], days: undefined });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <select
          aria-label="Field"
          value={condition.field}
          onChange={(event) => changeField(event.target.value)}
          className={`${selectClass} w-full sm:w-64`}
        >
          {SCOPES.map((scope) => (
            <optgroup key={scope} label={SCOPE_LABEL[scope]}>
              {SEGMENT_FIELDS.filter((f) => f.scope === scope).map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <select
          aria-label="Condition"
          value={condition.operator}
          onChange={(event) => changeOperator(event.target.value as Operator)}
          className={`${selectClass} w-full sm:w-56`}
        >
          {(field?.operators ?? []).map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABEL[operator]}
            </option>
          ))}
        </select>

        {noValue ? null : condition.operator === Operator.WITHIN_NEXT_DAYS ? (
          <div className="flex items-center gap-2">
            <input
              aria-label="Days"
              type="number"
              min={1}
              max={3650}
              value={condition.days ?? ""}
              onChange={(event) =>
                onChange({ ...condition, days: Number(event.target.value) })
              }
              className={`${selectClass} sm:w-28`}
            />
            <span className="text-sm text-slate-600">days</span>
          </div>
        ) : choices.length > 0 ? (
          isList ? (
            <select
              aria-label="Values"
              multiple
              value={condition.values ?? []}
              onChange={(event) =>
                onChange({
                  ...condition,
                  values: [...event.target.selectedOptions].map((o) => o.value),
                })
              }
              className={`${selectClass} h-28 w-full sm:w-64`}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Value"
              value={condition.value ?? ""}
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
              className={`${selectClass} w-full sm:w-64`}
            >
              <option value="">Choose…</option>
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          )
        ) : (
          <input
            aria-label="Value"
            type={field?.valueKind === ValueKind.DATE ? "date" : "text"}
            value={condition.value ?? ""}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
            placeholder={field?.valueKind === ValueKind.DATE ? "" : "Type a value"}
            className={`${selectClass} w-full sm:w-64`}
          />
        )}

        <button
          type="button"
          onClick={onRemove}
          className={`${buttonSubtle} ms-auto`}
          aria-label="Remove this condition"
        >
          Remove
        </button>
      </div>

      {field?.hint ? (
        <p className="mt-1.5 text-xs text-slate-500">{field.hint}</p>
      ) : null}
      {field?.coverageNote ? (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Heads up: {field.coverageNote}
        </p>
      ) : null}
    </div>
  );
}

export function SegmentBuilder({
  saveAction,
  previewAction,
  lookups,
  initial,
  segmentId,
  initialName = "",
  initialDescription = "",
}: {
  saveAction: SaveAction;
  previewAction: PreviewAction;
  lookups: LookupOptions;
  initial: SegmentDefinition;
  segmentId?: string;
  initialName?: string;
  initialDescription?: string;
}) {
  const [definition, setDefinition] = useState<SegmentDefinition>(initial);
  const [language, setLanguage] = useState<string>("NONE");

  const [saveState, saveFormAction, saving] = useActionState(saveAction, {
    ok: false,
    errors: [],
  });
  const [previewState, previewFormAction, previewing] = useActionState(
    previewAction,
    { ok: false, errors: [], preview: null },
  );

  const serialized = useMemo(() => JSON.stringify(definition), [definition]);

  const summary = useMemo(() => {
    const parts = definition.conditions.map(describeCondition);
    definition.groups.forEach((group) => {
      const inner = group.conditions.map(describeCondition).join(
        group.match === GroupMatch.ANY ? " or " : " and ",
      );
      parts.push(`(${inner})`);
    });
    return parts;
  }, [definition]);

  const setConditions = (conditions: SegmentCondition[]) =>
    setDefinition((d) => ({ ...d, conditions }));
  const setGroups = (groups: SegmentGroup[]) =>
    setDefinition((d) => ({ ...d, groups }));

  return (
    // One form, two submit buttons. The save and preview actions each own their
    // own state; the preview button overrides the action with formAction. A
    // second <form> plus `form="..."` association proved fragile in the browser.
    <form action={saveFormAction} className="space-y-6">
      <input type="hidden" name="definition" value={serialized} />
      <input type="hidden" name="language" value={language} />
      {segmentId ? <input type="hidden" name="id" value={segmentId} /> : null}

      <ErrorSummary
        errors={[...saveState.errors, ...previewState.errors].map((issue) => ({
          field: issue.path,
          message: issue.message,
        }))}
      />

      {saveState.ok ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-800">Segment saved.</p>
        </div>
      ) : null}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Segment name" required>
            <input
              type="text"
              name="name"
              defaultValue={initialName}
              required
              maxLength={150}
              placeholder="For example: GPS customers with an expiring subscription"
              className={inputClass}
            />
          </Field>
          <Field label="Description" hint="Optional — what this audience is for.">
            <input
              type="text"
              name="description"
              defaultValue={initialDescription}
              maxLength={300}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Which addresses should be included?
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The accounting address is never used for newsletters.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2.5 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={definition.include.companyEmails}
              onChange={(event) =>
                setDefinition((d) => ({
                  ...d,
                  include: { ...d.include, companyEmails: event.target.checked },
                }))
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Company newsletter addresses
          </label>
          <label className="flex items-center gap-2.5 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={definition.include.contactEmails}
              onChange={(event) =>
                setDefinition((d) => ({
                  ...d,
                  include: { ...d.include, contactEmails: event.target.checked },
                }))
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Contact addresses
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">
          Match <span className="text-sky-700">all</span> of these conditions
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          A customer must satisfy every condition here. Use a group below when any
          one of several values is acceptable.
        </p>

        <div className="mt-3 space-y-2">
          {definition.conditions.map((condition, index) => (
            <ConditionRow
              key={index}
              condition={condition}
              lookups={lookups}
              onChange={(next) =>
                setConditions(
                  definition.conditions.map((c, i) => (i === index ? next : c)),
                )
              }
              onRemove={() =>
                setConditions(definition.conditions.filter((_, i) => i !== index))
              }
            />
          ))}
          {definition.conditions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3.5 py-4 text-sm text-slate-500">
              No conditions yet — this would select every customer.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setConditions([...definition.conditions, defaultCondition()])}
          className={`${buttonSecondary} mt-3`}
        >
          + Add condition
        </button>
      </Card>

      {definition.groups.map((group, groupIndex) => (
        <Card key={groupIndex}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">And match</h2>
            <select
              aria-label="Group combinator"
              value={group.match}
              onChange={(event) =>
                setGroups(
                  definition.groups.map((g, i) =>
                    i === groupIndex
                      ? { ...g, match: event.target.value as GroupMatch }
                      : g,
                  ),
                )
              }
              className={`${selectClass} sm:w-32`}
            >
              <option value={GroupMatch.ANY}>any</option>
              <option value={GroupMatch.ALL}>all</option>
            </select>
            <span className="text-base font-semibold text-slate-900">
              of these:
            </span>
            <button
              type="button"
              onClick={() =>
                setGroups(definition.groups.filter((_, i) => i !== groupIndex))
              }
              className={`${buttonSubtle} ms-auto`}
            >
              Remove group
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            All conditions in one group must be about the same thing.
          </p>

          <div className="mt-3 space-y-2">
            {group.conditions.map((condition, index) => (
              <ConditionRow
                key={index}
                condition={condition}
                lookups={lookups}
                onChange={(next) =>
                  setGroups(
                    definition.groups.map((g, i) =>
                      i === groupIndex
                        ? {
                            ...g,
                            conditions: g.conditions.map((c, ci) =>
                              ci === index ? next : c,
                            ),
                          }
                        : g,
                    ),
                  )
                }
                onRemove={() =>
                  setGroups(
                    definition.groups.map((g, i) =>
                      i === groupIndex
                        ? {
                            ...g,
                            conditions: g.conditions.filter((_, ci) => ci !== index),
                          }
                        : g,
                    ),
                  )
                }
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setGroups(
                definition.groups.map((g, i) =>
                  i === groupIndex
                    ? { ...g, conditions: [...g.conditions, defaultCondition()] }
                    : g,
                ),
              )
            }
            className={`${buttonSecondary} mt-3`}
          >
            + Add condition to this group
          </button>
        </Card>
      ))}

      <button
        type="button"
        onClick={() =>
          setGroups([
            ...definition.groups,
            { match: GroupMatch.ANY, conditions: [defaultCondition()] },
          ])
        }
        className={buttonSecondary}
      >
        + Add a group
      </button>

      {summary.length > 0 ? (
        <Card>
          <h2 className="text-sm font-semibold text-slate-800">In plain words</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-slate-700">
            {summary.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Preview as"
            hint="A Hebrew or Arabic newsletter only reaches addresses set to that language."
          >
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className={`${selectClass} sm:w-56`}
            >
              <option value="NONE">Any language (not localized)</option>
              <option value="HE">{LANGUAGE_LABEL.HE} newsletter</option>
              <option value="AR">{LANGUAGE_LABEL.AR} newsletter</option>
            </select>
          </Field>

          <button
            type="submit"
            formAction={previewFormAction}
            className={buttonPrimary}
            disabled={previewing}
          >
            {previewing ? "Calculating…" : "Preview audience"}
          </button>

          <button type="submit" className={buttonSecondary} disabled={saving}>
            {saving ? "Saving…" : segmentId ? "Save changes" : "Save segment"}
          </button>
        </div>
      </Card>

      {previewState.preview ? (
        <AudiencePreviewPanel preview={previewState.preview} />
      ) : null}
    </form>
  );
}
