import Link from "next/link";

import {
  getFilterOptions,
  listCommunicationAddresses,
} from "../../server/services/communicationService";
import { CommunicationTable } from "../../ui/CommunicationTable";
import { Card, PageHeader, buttonSecondary, inputClass } from "../../ui/primitives";
import { setConsentAction, setLanguageAction } from "./actions";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Communication settings — AXIS" };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-2xl font-bold tabular-nums text-slate-900">
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-700">{label}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.VIEW_CRM, "/communication");
  const params = await searchParams;
  const filters = {
    search: one(params.search),
    language: one(params.language),
    consent: one(params.consent),
    emailStatus: one(params.emailStatus),
    state: one(params.state),
    classification: one(params.classification),
    category: one(params.category),
    company: one(params.company),
    sourceKind: one(params.sourceKind),
    page: Number(one(params.page) ?? "1") || 1,
  };

  const [page, options] = await Promise.all([
    listCommunicationAddresses(filters),
    getFilterOptions(),
  ]);

  const keep = (extra: Record<string, string>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...extra })) {
      if (value !== undefined && value !== "" && key !== "page") {
        query.set(key, String(value));
      }
    }
    if (extra.page) query.set("page", extra.page);
    return `/communication?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communication settings"
        description="Language, consent and delivery state for each email address. These belong to AXIS — a Monday sync never changes them."
        actions={
          <Link href="/segments" className={buttonSecondary}>
            Audiences
          </Link>
        }
      />

      <section aria-labelledby="language-counts">
        <h2
          id="language-counts"
          className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500"
        >
          Language
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Language not set"
            value={options.counts.UNKNOWN}
            hint="Excluded from Hebrew and Arabic newsletters"
          />
          <Stat label="Hebrew" value={options.counts.HE} />
          <Stat label="Arabic" value={options.counts.AR} />
        </div>
      </section>

      <section aria-labelledby="consent-counts">
        <h2
          id="consent-counts"
          className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500"
        >
          Consent
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Not confirmed"
            value={options.consent.UNKNOWN}
            hint="Nobody refused, and nobody confirmed"
          />
          <Stat
            label="Approved for communication"
            value={options.consent.GRANTED}
            hint="A person recorded a documented basis"
          />
          <Stat
            label="Do not send"
            value={options.consent.DENIED}
            hint="Excluded from every newsletter"
          />
        </div>
      </section>

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Search address</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search ?? ""}
              placeholder="name@example.com"
              className={`${inputClass} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Language</span>
            <select
              name="language"
              defaultValue={filters.language ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Any</option>
              <option value="UNKNOWN">Not set</option>
              <option value="HE">Hebrew</option>
              <option value="AR">Arabic</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Consent</span>
            <select
              name="consent"
              defaultValue={filters.consent ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Any</option>
              <option value="UNKNOWN">Not confirmed</option>
              <option value="GRANTED">Approved for communication</option>
              <option value="DENIED">Do not send</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Address check</span>
            <select
              name="emailStatus"
              defaultValue={filters.emailStatus ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Any</option>
              <option value="UNKNOWN">Not checked</option>
              <option value="VALID">Checked and valid</option>
              <option value="INVALID">Known invalid</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Delivery state</span>
            <select
              name="state"
              defaultValue={filters.state ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Any</option>
              <option value="SENDABLE">Not unsubscribed or blocked</option>
              <option value="UNSUBSCRIBED">Unsubscribed</option>
              <option value="SUPPRESSED">Blocked</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">
              Customer classification
            </span>
            <select
              name="classification"
              defaultValue={filters.classification ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Any</option>
              {options.classifications.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Company name</span>
            <input
              type="search"
              name="company"
              defaultValue={filters.company ?? ""}
              className={`${inputClass} mt-1`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Comes from</span>
            <select
              name="sourceKind"
              defaultValue={filters.sourceKind ?? "ALL"}
              className={`${inputClass} mt-1`}
            >
              <option value="ALL">Company or contact</option>
              <option value="COMPANY_EMAIL">Company addresses</option>
              <option value="CONTACT_EMAIL">Contact addresses</option>
            </select>
          </label>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800"
            >
              Apply filters
            </button>
            <Link href="/communication" className={buttonSecondary}>
              Clear
            </Link>
            <p className="ms-auto text-sm text-slate-600">
              {page.total.toLocaleString()} address
              {page.total === 1 ? "" : "es"} · page {page.page} of {page.pageCount}
            </p>
          </div>
        </form>
      </Card>

      <CommunicationTable
        rows={page.rows}
        action={setLanguageAction}
        consentAction={setConsentAction}
        totalMatching={page.total}
        allMatchingIds={page.allMatchingIds}
        matchingTruncated={page.matchingTruncated}
      />

      {page.pageCount > 1 ? (
        <div className="flex items-center justify-between">
          {page.page > 1 ? (
            <Link href={keep({ page: String(page.page - 1) })} className={buttonSecondary}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page.page < page.pageCount ? (
            <Link href={keep({ page: String(page.page + 1) })} className={buttonSecondary}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <Card>
        <h2 className="text-sm font-semibold text-slate-800">What this page does not do</h2>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-slate-600">
          <li>It never changes anything in Monday — language does not exist there.</li>
          <li>
            It never grants consent by itself. Language and consent are separate;
            assigning a language does not mean a customer agreed to receive email, and
            no bulk action can approve addresses you have not explicitly selected.
          </li>
          <li>
            Approving an address does not override an unsubscribe, a blocked address or
            an invalid one — those still exclude it from every send.
          </li>
          <li>It never changes unsubscribe or blocked status, and never sends email.</li>
        </ul>
      </Card>
    </div>
  );
}
