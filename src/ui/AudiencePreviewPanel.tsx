"use client";

import { useState } from "react";

import type { AudiencePreview } from "../server/services/segmentService";
import {
  EMAIL_SOURCE_LABEL,
  EXCLUSION_REASON_HINT,
  EXCLUSION_REASON_LABEL,
  LANGUAGE_LABEL,
} from "./labels";
import { Card } from "./primitives";

/**
 * What would happen if this audience were used.
 *
 * Two numbers matter and must never be conflated: CRM records matched, and
 * addresses that would actually be emailed. Everything dropped in between is
 * shown with a reason — an audience must never lose people silently.
 */

function Stat({
  value,
  label,
  hint,
  tone = "default",
}: {
  value: number;
  label: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-700">{label}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function AudiencePreviewPanel({
  preview,
  title = "Audience preview",
}: {
  preview: AudiencePreview;
  title?: string;
}) {
  const [showExclusions, setShowExclusions] = useState(false);
  const [showDestinations, setShowDestinations] = useState(false);

  const { snapshot } = preview;
  const breakdown = Object.entries(snapshot.breakdown)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const duplicates = preview.destinations.filter((d) => d.sources.length > 1);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">
          Nothing is sent and no recipient is created. This is a calculation.
        </p>
      </div>

      {preview.requireLanguage ? (
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Calculated for a <strong>{LANGUAGE_LABEL[preview.requireLanguage]}</strong>{" "}
          newsletter. Addresses in another language, or with no language set, are
          excluded.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          value={preview.matchedCompanies}
          label="Companies matched"
          hint="From the customer board"
        />
        <Stat
          value={preview.matchedContacts}
          label="Contacts matched"
          hint="From the contacts board"
        />
        <Stat
          value={snapshot.matchedRecords}
          label="CRM email sources"
          hint="Every matching record, before merging"
        />
        <Stat
          value={snapshot.duplicateSourcesCollapsed}
          label="Duplicates merged"
          hint="Same address on several records"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Stat
          value={snapshot.uniqueDestinations}
          label="Addresses that would be emailed"
          hint="One message per address, never more"
          tone="good"
        />
        <Stat
          value={snapshot.excluded}
          label="Excluded"
          hint="Every one has a reason, listed below"
          tone={snapshot.excluded > 0 ? "warn" : "default"}
        />
      </div>

      {breakdown.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-800">
            Why addresses were excluded
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {breakdown.map(([reason, count]) => (
              <li
                key={reason}
                className="flex items-baseline justify-between gap-4 px-3.5 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {EXCLUSION_REASON_LABEL[reason] ?? reason}
                  </p>
                  {EXCLUSION_REASON_HINT[reason] ? (
                    <p className="text-xs text-slate-500">
                      {EXCLUSION_REASON_HINT[reason]}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-700">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setShowExclusions((v) => !v)}
            className="mt-2 text-sm font-semibold text-sky-700 hover:text-sky-900"
          >
            {showExclusions ? "Hide excluded addresses" : "View excluded addresses"}
          </button>

          {showExclusions ? (
            <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-start">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold text-slate-700">
                      Address
                    </th>
                    <th className="px-3 py-2 text-start font-semibold text-slate-700">
                      From
                    </th>
                    <th className="px-3 py-2 text-start font-semibold text-slate-700">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.exclusions.map((exclusion, index) => (
                    <tr key={`${exclusion.label}-${index}`}>
                      <td className="px-3 py-2 text-slate-800" dir="ltr">
                        {exclusion.normalizedEmail ??
                          exclusion.rawEmail ??
                          "No address"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {exclusion.label}
                        <span className="ms-1 text-xs text-slate-400">
                          ({EMAIL_SOURCE_LABEL[exclusion.kind]})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {EXCLUSION_REASON_LABEL[exclusion.reason] ?? exclusion.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.exclusionsTruncated ? (
                <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Showing the first {preview.exclusions.length.toLocaleString()} of{" "}
                  {snapshot.excluded.toLocaleString()} excluded addresses.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {duplicates.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-800">
            Addresses found on more than one record
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Each of these receives <strong>one</strong> email, not one per record.
          </p>
          <ul className="mt-2 space-y-2">
            {duplicates.slice(0, 25).map((destination) => (
              <li
                key={destination.normalizedEmail}
                className="rounded-lg border border-slate-200 px-3.5 py-2.5"
              >
                <p className="text-sm font-semibold text-slate-900" dir="ltr">
                  {destination.normalizedEmail}
                </p>
                <p className="mt-1 text-xs text-slate-500">Matched from:</p>
                <ul className="mt-0.5 space-y-0.5 text-sm text-slate-700">
                  {destination.sources.map((source, index) => (
                    <li key={`${source.label}-${index}`}>
                      <span className="text-slate-500">
                        {EMAIL_SOURCE_LABEL[source.kind]}:
                      </span>{" "}
                      {source.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs font-medium text-emerald-700">
                  Delivery preview: 1 email
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.destinations.length > 0 ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowDestinations((v) => !v)}
            className="text-sm font-semibold text-sky-700 hover:text-sky-900"
          >
            {showDestinations
              ? "Hide the addresses that would be emailed"
              : "View the addresses that would be emailed"}
          </button>
          {showDestinations ? (
            <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
              <ul className="divide-y divide-slate-100">
                {preview.destinations.map((destination) => (
                  <li
                    key={destination.normalizedEmail}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 py-2"
                  >
                    <span className="text-sm text-slate-800" dir="ltr">
                      {destination.normalizedEmail}
                    </span>
                    <span className="text-xs text-slate-500">
                      {destination.sources.length === 1
                        ? destination.sources[0].label
                        : `${destination.sources.length} records`}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.destinationsTruncated ? (
                <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Showing the first {preview.destinations.length.toLocaleString()} of{" "}
                  {snapshot.uniqueDestinations.toLocaleString()} addresses.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
          No address matches these conditions yet.
        </p>
      )}
    </Card>
  );
}
