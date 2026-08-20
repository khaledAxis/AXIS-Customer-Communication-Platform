import Link from "next/link";

import { checkCrmConfiguration } from "../../server/services/crmSyncService";
import {
  CUSTOMERS_PAGE_SIZE,
  getCrmOverview,
  listCustomers,
} from "../../server/services/customerService";
import { formatDate } from "../../ui/labels";
import { Badge, Card, EmptyState, PageHeader, buttonSubtle } from "../../ui/primitives";
import { CrmSyncPanel } from "../../ui/CrmSyncPanel";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  POTENTIAL: "Potential",
  INACTIVE: "Not active",
  UNKNOWN: "Not set",
};

const STATUS_TONE: Record<string, "success" | "info" | "neutral" | "warning"> = {
  ACTIVE: "success",
  POTENTIAL: "info",
  INACTIVE: "neutral",
  UNKNOWN: "neutral",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.VIEW_CRM, "/customers");
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10) || 1;

  const [overview, result, crm] = await Promise.all([
    getCrmOverview(),
    listCustomers({
      search: params.search,
      status: params.status,
      industryId: params.industry,
      classificationId: params.classification,
      page,
    }),
    Promise.resolve(checkCrmConfiguration()),
  ]);

  const hasFilters = Boolean(
    params.search || (params.status && params.status !== "ALL") ||
      (params.industry && params.industry !== "ALL") ||
      (params.classification && params.classification !== "ALL"),
  );

  const pageLink = (next: number) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.status) query.set("status", params.status);
    if (params.industry) query.set("industry", params.industry);
    if (params.classification) query.set("classification", params.classification);
    query.set("page", String(next));
    return `/customers?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Company and contact details come from Monday.com, which stays the master record. This is a read-only copy."
      />

      {params.synced ? (
        <div role="status" className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            {params.message ?? "Customer information updated from Monday."}
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            {params.companies} companies · {params.contacts} contacts · {params.products} products ·{" "}
            {params.customerProducts} customer products
          </p>
        </div>
      ) : null}

      {params.error ? (
        <div role="alert" className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{params.error}</p>
        </div>
      ) : null}

      <CrmSyncPanel
        connected={crm.configured}
        statusMessage={crm.message}
        lastSyncAt={overview.lastSyncAt ? overview.lastSyncAt.toISOString() : null}
        counts={{
          companies: overview.companies,
          contacts: overview.contacts,
          products: overview.products,
          customerProducts: overview.customerProducts,
          addresses: overview.addresses,
        }}
      />

      {/* ---------------- filters ---------------- */}
      <Card className="mt-6 p-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Company name, email, phone…"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={params.status ?? "ALL"}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm"
            >
              <option value="ALL">All</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="industry">
              Industry
            </label>
            <select
              id="industry"
              name="industry"
              defaultValue={params.industry ?? "ALL"}
              className="mt-1 block max-w-[14rem] rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm"
            >
              <option value="ALL">All</option>
              {overview.industries.map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="classification">
              Classification
            </label>
            <select
              id="classification"
              name="classification"
              defaultValue={params.classification ?? "ALL"}
              className="mt-1 block max-w-[14rem] rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm"
            >
              <option value="ALL">All</option>
              {overview.classifications.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Apply
          </button>
          {hasFilters ? (
            <Link href="/customers" className={buttonSubtle}>
              Clear
            </Link>
          ) : null}
        </form>
      </Card>

      {/* ---------------- results ---------------- */}
      {result.total === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="👥"
            title={hasFilters ? "No customers match those filters" : "No customer data yet"}
            description={
              hasFilters
                ? "Try a different search or clear the filters."
                : "Press “Sync from Monday” above to bring in company and contact details. Nothing is ever written back to Monday."
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-600">
            {result.total.toLocaleString()} {result.total === 1 ? "company" : "companies"}
            {result.pageCount > 1
              ? ` · page ${result.page} of ${result.pageCount}`
              : ""}
          </p>

          <Card className="mt-3 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {[
                      "Company",
                      "Status",
                      "Industry",
                      "Category",
                      "Phone",
                      "Newsletter email",
                      "Contacts",
                      "Products",
                      "Last synced",
                    ].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.companies.map((company) => (
                    <tr key={company.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/customers/${company.id}`}
                          className="font-semibold text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {company.name ?? "(no name)"}
                        </Link>
                        {company.archivedAt ? (
                          <div className="mt-1">
                            <Badge tone="warning">Archived in Monday</Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[company.customerStatus] ?? "neutral"}>
                          {STATUS_LABEL[company.customerStatus] ?? company.customerStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{company.industry?.label ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{company.category ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">
                        {company.companyPhone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">
                        {company.companyEmail ?? (
                          <span className="text-slate-400">No newsletter email</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">
                        {company._count.contactLinks}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">
                        {company._count.ownedProducts}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(company.syncedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {result.pageCount > 1 ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
              <span className="text-sm text-slate-500">
                Showing {(result.page - 1) * CUSTOMERS_PAGE_SIZE + 1}–
                {Math.min(result.page * CUSTOMERS_PAGE_SIZE, result.total)} of{" "}
                {result.total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link href={pageLink(result.page - 1)} className={buttonSubtle}>
                    ← Previous
                  </Link>
                ) : null}
                {result.page < result.pageCount ? (
                  <Link href={pageLink(result.page + 1)} className={buttonSubtle}>
                    Next →
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
