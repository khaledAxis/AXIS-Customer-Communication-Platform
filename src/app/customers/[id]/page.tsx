import Link from "next/link";
import { notFound } from "next/navigation";

import { getCommunicationState, getCustomer } from "../../../server/services/customerService";
import { setCustomerLanguageAction } from "../actions";
import { LANGUAGE_LABEL, formatDate } from "../../../ui/labels";
import { Badge, Card, PageHeader, buttonSecondary, buttonSubtle } from "../../../ui/primitives";
import { Capability, requirePageCapability } from "../../../server/auth/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  POTENTIAL: "Potential",
  INACTIVE: "Not active",
  UNKNOWN: "Not set",
};

const CONSENT_LABEL: Record<string, string> = {
  GRANTED: "Given",
  DENIED: "Refused",
  UNKNOWN: "Not recorded",
};

const EMAIL_STATUS_LABEL: Record<string, string> = {
  VALID: "Looks valid",
  INVALID: "Not valid",
  UNKNOWN: "Not checked",
};

function Row({ label, value, ltr = false }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900" dir={ltr ? "ltr" : undefined}>
        {value && value.trim() !== "" ? value : <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.VIEW_CRM, "/customers");
  const { id } = await params;
  const company = await getCustomer(id);
  if (!company) notFound();

  // Local communication state is looked up separately from the CRM data on purpose.
  const emails = [
    company.companyEmailNorm,
    ...company.contactLinks.map((link) => link.contact.emailNorm),
  ].filter((value): value is string => typeof value === "string" && value !== "");

  const communication = await getCommunicationState([...new Set(emails)]);

  return (
    <>
      <PageHeader
        title={company.name ?? "(no name)"}
        description="Customer details are managed in Monday.com. Communication settings below are managed here."
        actions={
          <>
            {company.archivedAt ? <Badge tone="warning">Archived in Monday</Badge> : null}
            <Badge tone="neutral">{STATUS_LABEL[company.customerStatus] ?? company.customerStatus}</Badge>
            <Link href="/customers" className={buttonSecondary}>
              All customers
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------- company (Monday-owned) ------------------- */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Company information</h2>
            <span className="text-xs font-semibold text-slate-400">from Monday</span>
          </div>
          <dl className="mt-3">
            <Row label="Status" value={STATUS_LABEL[company.customerStatus] ?? null} />
            <Row label="Industry" value={company.industry?.label ?? null} />
            <Row label="Classification" value={company.classification?.label ?? null} />
            <Row label="Category" value={company.category} />
            <Row label="Company number" value={company.companyNumber} ltr />
            <Row label="Phone" value={company.companyPhone} ltr />
            <Row label="Newsletter email" value={company.companyEmail} ltr />
            <Row label="Last synced" value={formatDate(company.syncedAt)} />
          </dl>
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            To change any of this, edit the customer in Monday.com and sync again.
          </p>
          {company.accountingEmail ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This company also has a bookkeeping email in Monday. It is deliberately never used
              for newsletters.
            </p>
          ) : null}
        </Card>

        {/* ------------------------- contacts ------------------------- */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              Contacts ({company.contactLinks.length})
            </h2>
            <span className="text-xs font-semibold text-slate-400">from Monday</span>
          </div>

          {company.contactLinks.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              This company has no contacts in Monday.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Name", "Job title", "Phone", "Email", "Communication"].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-2 py-2 text-start text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {company.contactLinks.map((link) => {
                    const contact = link.contact;
                    const state = contact.emailNorm ? communication.get(contact.emailNorm) : undefined;
                    return (
                      <tr key={link.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-2 font-medium text-slate-900">
                          {contact.fullName ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-slate-600">{contact.jobTitle ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-600" dir="ltr">
                          {contact.phone ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-slate-600" dir="ltr">
                          {contact.email ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-2">
                          {state ? (
                            <div className="flex flex-wrap gap-1">
                              {state.isUnsubscribed ? <Badge tone="danger">Unsubscribed</Badge> : null}
                              {state.isSuppressed ? <Badge tone="danger">Suppressed</Badge> : null}
                              {!state.isUnsubscribed && !state.isSuppressed ? (
                                <Badge tone="neutral">{LANGUAGE_LABEL[state.language] ?? state.language}</Badge>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No email</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* -------------------- products / subscriptions -------------------- */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              Products &amp; subscriptions ({company.ownedProducts.length})
            </h2>
            <span className="text-xs font-semibold text-slate-400">from Monday</span>
          </div>

          {company.ownedProducts.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              No products recorded for this company in Monday.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Product", "Status", "Purchased", "Subscription ends", "SIMs"].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-2 py-2 text-start text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {company.ownedProducts.map((owned) => (
                    <tr key={owned.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2">
                        <div className="font-medium text-slate-900">
                          {owned.product?.name ?? "(unlinked product)"}
                        </div>
                        {owned.product?.sku ? (
                          <div className="text-xs text-slate-500" dir="ltr">
                            {owned.product.sku}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-600">{owned.status ?? "—"}</td>
                      <td className="px-2 py-2 text-slate-600">{formatDate(owned.purchaseDate)}</td>
                      <td className="px-2 py-2 text-slate-600">
                        {formatDate(owned.subscriptionUntil)}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-slate-600">
                        {owned.simCount ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ------------- communication settings (AXIS-local) ------------- */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Communication settings</h2>
            <span className="text-xs font-semibold text-emerald-600">managed here</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            These belong to AXIS, not Monday. A sync never changes them.
          </p>

          {communication.size === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              No usable email addresses for this company yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...communication.values()].map((state) => (
                <li key={state.normalizedEmail} className="rounded-lg border border-slate-200 p-3">
                  <div className="break-all text-sm font-medium text-slate-900" dir="ltr">
                    {state.normalizedEmail}
                  </div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Language</dt>
                      <dd className="font-medium text-slate-800">
                        {LANGUAGE_LABEL[state.language] ?? state.language}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Consent</dt>
                      <dd className="font-medium text-slate-800">
                        {CONSENT_LABEL[state.consentStatus] ?? state.consentStatus}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Email address</dt>
                      <dd className="font-medium text-slate-800">
                        {EMAIL_STATUS_LABEL[state.emailStatus] ?? state.emailStatus}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {state.isUnsubscribed ? <Badge tone="danger">Unsubscribed</Badge> : null}
                    {state.isSuppressed ? <Badge tone="danger">Suppressed</Badge> : null}
                    {!state.isUnsubscribed && !state.isSuppressed ? (
                      <Badge tone="success">Can receive newsletters</Badge>
                    ) : null}
                  </div>

                  {/* Language is the one setting staff assign here. Consent and
                      delivery state are deliberately read-only (ADR-0020). */}
                  <form action={setCustomerLanguageAction} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="addressId" value={state.id} />
                    <input type="hidden" name="companyId" value={company.id} />
                    <label className="text-xs text-slate-500" htmlFor={`lang-${state.id}`}>
                      Set language
                    </label>
                    <select
                      id={`lang-${state.id}`}
                      name="language"
                      defaultValue={state.language}
                      key={state.language}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="UNKNOWN">Not set</option>
                      <option value="HE">Hebrew</option>
                      <option value="AR">Arabic</option>
                    </select>
                    <button type="submit" className={buttonSubtle}>
                      Save
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
