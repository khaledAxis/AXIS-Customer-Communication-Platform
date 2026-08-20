"use client";

import { useActionState, useMemo, useState } from "react";

import type {
  ConsentFormState,
  LanguageFormState,
} from "../app/communication/actions";
import {
  ASSIGNABLE_CONSENT,
  CONSENT_SOURCES,
  CONSENT_SOURCE_REQUIRES_NOTE,
} from "../domain/communication/consentAssignment";
import { ASSIGNABLE_LANGUAGES } from "../domain/communication/languageAssignment";
import type { CommunicationRow } from "../server/services/communicationService";
import {
  CONSENT_SOURCE_LABEL,
  CONSENT_STATUS_LABEL,
  CONSENT_STATUS_TONE,
  EMAIL_SOURCE_LABEL,
  EMAIL_STATUS_LABEL,
  LANGUAGE_LABEL,
  formatDate,
} from "./labels";
import {
  Badge,
  Card,
  buttonPrimary,
  buttonSecondary,
  buttonSubtle,
  inputClass,
} from "./primitives";

/**
 * Assigning communication language and consent.
 *
 * One row per email address, never one per CRM record: several company and contact
 * records commonly share an address, and they share ONE communication profile. The
 * row shows every contributing record so nobody changes a shared setting believing it
 * affects a single person.
 *
 * Language and consent are edited through two separate forms that post to two
 * separate server actions. Nothing on this screen can change unsubscribe, blocked
 * status or the address check, and approving an address for communication never
 * overrides an unsubscribe — the send-time rules still apply (ADR-0020, ADR-0021).
 *
 * Approving is deliberately the slowest action here: it needs a documented basis, an
 * effective date, a confirmation tick and a second confirm step. Refusing needs only
 * the confirmation, because refusing to email someone is never the risky direction.
 */

type LanguageAction = (
  state: LanguageFormState,
  formData: FormData,
) => Promise<LanguageFormState>;

type ConsentAction = (
  state: ConsentFormState,
  formData: FormData,
) => Promise<ConsentFormState>;

function LanguagePill({ language }: { language: string }) {
  const tone =
    language === "HE" ? "info" : language === "AR" ? "success" : "neutral";
  return <Badge tone={tone}>{LANGUAGE_LABEL[language] ?? language}</Badge>;
}

function Notice({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900"
      }`}
    >
      <p className="font-semibold">{state.message}</p>
    </div>
  );
}

/** Today as yyyy-mm-dd, for the effective-date default. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CommunicationTable({
  rows,
  action,
  consentAction,
  totalMatching,
  allMatchingIds,
  matchingTruncated,
}: {
  rows: CommunicationRow[];
  action: LanguageAction;
  consentAction: ConsentAction;
  totalMatching: number;
  allMatchingIds: string[];
  matchingTruncated: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState<string>("HE");
  const [confirming, setConfirming] = useState(false);

  const [consentStatus, setConsentStatus] = useState<string>("GRANTED");
  const [consentSource, setConsentSource] = useState<string>("");
  const [consentNote, setConsentNote] = useState<string>("");
  const [consentDate, setConsentDate] = useState<string>(todayIso());
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentConfirming, setConsentConfirming] = useState(false);

  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  const [consentState, consentFormAction, consentPending] = useActionState(
    consentAction,
    { ok: false, message: "" },
  );

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allOnPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  /** Any selection change invalidates both pending confirmations. */
  const resetConfirmations = () => {
    setConfirming(false);
    setConsentConfirming(false);
  };

  const toggle = (id: string) => {
    resetConfirmations();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    resetConfirmations();
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectAllMatching = () => {
    resetConfirmations();
    setSelected(new Set(allMatchingIds));
  };

  const selectOnly = (id: string) => {
    resetConfirmations();
    setSelected(new Set([id]));
  };

  const clear = () => {
    resetConfirmations();
    setSelected(new Set());
  };

  // How many of the selected addresses would actually change value.
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const alreadyThatLanguage = selectedRows.filter(
    (row) => row.language === language,
  ).length;
  const selectedUnsubscribed = selectedRows.filter(
    (row) => row.isUnsubscribed || row.isSuppressed,
  ).length;

  const languageName = LANGUAGE_LABEL[language] ?? language;
  const consentName = CONSENT_STATUS_LABEL[consentStatus] ?? consentStatus;
  const granting = consentStatus === "GRANTED";
  const noteRequired =
    granting &&
    (CONSENT_SOURCE_REQUIRES_NOTE as readonly string[]).includes(consentSource);

  const consentReady =
    selected.size > 0 &&
    consentConfirmed &&
    (!granting ||
      (consentSource !== "" &&
        consentDate !== "" &&
        (!noteRequired || consentNote.trim() !== "")));

  const selectionHeader =
    selected.size === 0
      ? "No addresses selected"
      : `${selected.size.toLocaleString()} selected`;

  return (
    <div className="space-y-4">
      <Notice state={state} />
      {state.ok && state.before && state.after ? (
        <p className="-mt-2 text-xs text-slate-600">
          Hebrew {state.before.HE.toLocaleString()} →{" "}
          <strong>{state.after.HE.toLocaleString()}</strong> · Arabic{" "}
          {state.before.AR.toLocaleString()} →{" "}
          <strong>{state.after.AR.toLocaleString()}</strong> · Not set{" "}
          {state.before.UNKNOWN.toLocaleString()} →{" "}
          <strong>{state.after.UNKNOWN.toLocaleString()}</strong>. Nothing was sent.
        </p>
      ) : null}

      <Notice state={consentState} />
      {consentState.ok && consentState.before && consentState.after ? (
        <p className="-mt-2 text-xs text-slate-600">
          Approved {consentState.before.GRANTED.toLocaleString()} →{" "}
          <strong>{consentState.after.GRANTED.toLocaleString()}</strong> · Do not send{" "}
          {consentState.before.DENIED.toLocaleString()} →{" "}
          <strong>{consentState.after.DENIED.toLocaleString()}</strong> · Not confirmed{" "}
          {consentState.before.UNKNOWN.toLocaleString()} →{" "}
          <strong>{consentState.after.UNKNOWN.toLocaleString()}</strong>. Nothing was
          sent.
        </p>
      ) : null}

      {/* --------------------------- selection --------------------------- */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-800">
            {selectionHeader}
          </span>

          <button type="button" onClick={togglePage} className={buttonSubtle}>
            {allOnPageSelected ? "Clear this page" : "Select this page"}
          </button>

          {totalMatching > pageIds.length ? (
            <button type="button" onClick={selectAllMatching} className={buttonSubtle}>
              Select all{" "}
              {Math.min(totalMatching, allMatchingIds.length).toLocaleString()} matching
            </button>
          ) : null}

          {selected.size > 0 ? (
            <button type="button" onClick={clear} className={buttonSubtle}>
              Clear selection
            </button>
          ) : null}
        </div>

        {matchingTruncated ? (
          <p className="mt-2 text-xs text-amber-700">
            Only the first {allMatchingIds.length.toLocaleString()} matching addresses
            can be selected at once. Narrow the filters to reach the rest.
          </p>
        ) : null}
      </Card>

      {/* ---------------------------- language ---------------------------- */}
      <form action={formAction}>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="addressId" value={id} />
        ))}

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-bold text-slate-900">Communication language</h2>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-700">
                Set language to
                <select
                  name="language"
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value);
                    setConfirming(false);
                  }}
                  className="ms-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ASSIGNABLE_LANGUAGES.map((value) => (
                    <option key={value} value={value}>
                      {LANGUAGE_LABEL[value] ?? value}
                    </option>
                  ))}
                </select>
              </label>

              {/* Distinct keys matter: without them React reuses one DOM node and
                  flips its `type` from button to submit mid-click, which submits the
                  form immediately and skips the confirmation step entirely. */}
              {confirming ? (
                <button
                  key="confirm-language-change"
                  type="submit"
                  className={buttonPrimary}
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Yes, change them"}
                </button>
              ) : (
                <button
                  key="request-language-change"
                  type="button"
                  onClick={() => setConfirming(true)}
                  className={buttonSecondary}
                  disabled={selected.size === 0}
                >
                  Set language
                </button>
              )}
            </div>
          </div>

          {confirming ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                You are changing communication language for{" "}
                {selected.size.toLocaleString()} email address
                {selected.size === 1 ? "" : "es"} to {languageName}.
              </p>
              <p className="mt-1 text-xs text-amber-900">
                This changes only the language. Consent, unsubscribe, blocked status and
                the address check are not touched, and no email is sent.
                {alreadyThatLanguage > 0
                  ? ` ${alreadyThatLanguage} of the addresses on this page already use ${languageName}.`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={`${buttonSubtle} mt-2`}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </Card>
      </form>

      {/* ----------------------------- consent ---------------------------- */}
      <form action={consentFormAction}>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="addressId" value={id} />
        ))}

        <Card className="p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-bold text-slate-900">
              Consent for communication
            </h2>
            <p className="text-xs text-slate-600">
              You are recording a decision a person made. AXIS chooses the basis — this
              tool does not decide whether it is adequate.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Set consent to</span>
              <select
                name="consentStatus"
                value={consentStatus}
                onChange={(event) => {
                  setConsentStatus(event.target.value);
                  setConsentConfirming(false);
                }}
                className={`${inputClass} mt-1`}
              >
                {ASSIGNABLE_CONSENT.map((value) => (
                  <option key={value} value={value}>
                    {CONSENT_STATUS_LABEL[value] ?? value}
                  </option>
                ))}
              </select>
            </label>

            {granting ? (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Basis you are relying on
                  </span>
                  <select
                    name="consentSource"
                    value={consentSource}
                    onChange={(event) => {
                      setConsentSource(event.target.value);
                      setConsentConfirming(false);
                    }}
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">Choose a basis…</option>
                    {CONSENT_SOURCES.map((value) => (
                      <option key={value} value={value}>
                        {CONSENT_SOURCE_LABEL[value] ?? value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Applies from
                  </span>
                  <input
                    type="date"
                    name="consentEffectiveAt"
                    value={consentDate}
                    max={todayIso()}
                    onChange={(event) => {
                      setConsentDate(event.target.value);
                      setConsentConfirming(false);
                    }}
                    className={`${inputClass} mt-1`}
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Note {noteRequired ? "(required)" : "(optional)"}
                  </span>
                  <input
                    type="text"
                    name="consentNote"
                    value={consentNote}
                    maxLength={500}
                    placeholder="Where this permission is documented"
                    onChange={(event) => {
                      setConsentNote(event.target.value);
                      setConsentConfirming(false);
                    }}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </>
            ) : (
              <label className="block sm:col-span-2 lg:col-span-3">
                <span className="text-xs font-semibold text-slate-700">
                  Note (optional)
                </span>
                <input
                  type="text"
                  name="consentNote"
                  value={consentNote}
                  maxLength={500}
                  placeholder="Why this decision was made"
                  onChange={(event) => {
                    setConsentNote(event.target.value);
                    setConsentConfirming(false);
                  }}
                  className={`${inputClass} mt-1`}
                />
              </label>
            )}
          </div>

          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="consentConfirmed"
              checked={consentConfirmed}
              onChange={(event) => {
                setConsentConfirmed(event.target.checked);
                setConsentConfirming(false);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              {granting
                ? "I confirm AXIS holds this basis for contacting these addresses, and I am responsible for that decision."
                : "I confirm I want to record this decision for the selected addresses."}
            </span>
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {consentConfirming ? (
              <button
                key="confirm-consent-change"
                type="submit"
                className={buttonPrimary}
                disabled={consentPending}
              >
                {consentPending ? "Saving…" : "Yes, record this"}
              </button>
            ) : (
              <button
                key="request-consent-change"
                type="button"
                onClick={() => setConsentConfirming(true)}
                className={buttonSecondary}
                disabled={!consentReady}
              >
                Record consent
              </button>
            )}

            {!consentReady && selected.size > 0 ? (
              <span className="text-xs text-slate-500">
                {granting
                  ? "Choose a basis, a date, and tick the confirmation."
                  : "Tick the confirmation to continue."}
              </span>
            ) : null}
          </div>

          {consentConfirming ? (
            <div
              className={`mt-3 rounded-lg border p-3 ${
                granting
                  ? "border-amber-300 bg-amber-50"
                  : "border-slate-300 bg-slate-50"
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  granting ? "text-amber-900" : "text-slate-900"
                }`}
              >
                {granting
                  ? `You are marking ${selected.size.toLocaleString()} communication address${
                      selected.size === 1 ? "" : "es"
                    } as approved for communication.`
                  : `You are recording "${consentName}" for ${selected.size.toLocaleString()} communication address${
                      selected.size === 1 ? "" : "es"
                    }.`}
              </p>
              <p
                className={`mt-1 text-xs ${
                  granting ? "text-amber-900" : "text-slate-700"
                }`}
              >
                {granting
                  ? `Basis: ${CONSENT_SOURCE_LABEL[consentSource] ?? consentSource}, applying from ${consentDate}. Approving does not override an unsubscribe, a blocked address or an invalid one — those still exclude an address from every send.`
                  : "Marking an address as do-not-send makes it ineligible immediately. The address, its history and its CRM links are kept."}
                {selectedUnsubscribed > 0
                  ? ` ${selectedUnsubscribed} of the addresses on this page are already unsubscribed or blocked and will stay excluded.`
                  : ""}{" "}
                No email is sent by this change.
              </p>
              <button
                type="button"
                onClick={() => setConsentConfirming(false)}
                className={`${buttonSubtle} mt-2`}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </Card>
      </form>

      {/* ------------------------------ table ------------------------------ */}
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    aria-label="Select every address on this page"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                  Email address
                </th>
                <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                  Language
                </th>
                <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                  Consent
                </th>
                <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                  Address check
                </th>
                <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                  Comes from
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className={selected.has(row.id) ? "bg-sky-50/60" : ""}>
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.normalizedEmail}`}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="break-all font-medium text-slate-900" dir="ltr">
                      {row.normalizedEmail}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.isUnsubscribed ? (
                        <Badge tone="danger">Unsubscribed</Badge>
                      ) : null}
                      {row.isSuppressed ? <Badge tone="danger">Blocked</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <LanguagePill language={row.language} />
                    <form action={formAction} className="mt-1.5 flex items-center gap-1">
                      <input type="hidden" name="addressId" value={row.id} />
                      <select
                        name="language"
                        defaultValue={row.language}
                        key={row.language}
                        aria-label={`Language for ${row.normalizedEmail}`}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {ASSIGNABLE_LANGUAGES.map((value) => (
                          <option key={value} value={value}>
                            {LANGUAGE_LABEL[value] ?? value}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={buttonSubtle}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <Badge tone={CONSENT_STATUS_TONE[row.consentStatus] ?? "neutral"}>
                      {CONSENT_STATUS_LABEL[row.consentStatus] ?? row.consentStatus}
                    </Badge>
                    {row.consentStatus === "GRANTED" && row.consentSource ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {CONSENT_SOURCE_LABEL[row.consentSource] ?? row.consentSource}
                        {row.consentEffectiveAt
                          ? ` · from ${formatDate(row.consentEffectiveAt)}`
                          : ""}
                      </p>
                    ) : null}
                    {row.consentNote ? (
                      <p className="mt-0.5 text-xs text-slate-500">{row.consentNote}</p>
                    ) : null}
                    {/* Consent is never a one-click change: this only selects the row
                        so the evidence form above applies to it. */}
                    <button
                      type="button"
                      onClick={() => selectOnly(row.id)}
                      className={`${buttonSubtle} mt-1.5`}
                    >
                      Change consent
                    </button>
                  </td>
                  <td className="px-3 py-3 align-top text-slate-700">
                    {EMAIL_STATUS_LABEL[row.emailStatus] ?? row.emailStatus}
                  </td>
                  <td className="px-3 py-3 align-top">
                    {row.sources.length === 0 ? (
                      <span className="text-xs text-slate-400">No CRM record</span>
                    ) : (
                      <>
                        {row.sources.length > 1 ? (
                          <p className="mb-1 text-xs font-semibold text-amber-700">
                            Shared by {row.sources.length} records — one setting for all
                            of them
                          </p>
                        ) : null}
                        <ul className="space-y-0.5 text-xs text-slate-700">
                          {row.sources.slice(0, 5).map((source, index) => (
                            <li key={`${source.label}-${index}`}>
                              <span className="text-slate-500">
                                {EMAIL_SOURCE_LABEL[source.kind]}:
                              </span>{" "}
                              {source.label}
                              {source.companyName ? (
                                <span className="text-slate-400">
                                  {" "}
                                  ({source.companyName})
                                </span>
                              ) : null}
                            </li>
                          ))}
                          {row.sources.length > 5 ? (
                            <li className="text-slate-400">
                              and {row.sources.length - 5} more
                            </li>
                          ) : null}
                        </ul>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-600">
            No email addresses match these filters.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
