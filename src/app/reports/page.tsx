import Link from "next/link";
import { Capability, requirePageCapability } from "../../server/auth/session";
import { getDeliveryReport } from "../../server/services/reportService";
import { DeliveryMetrics } from "../../ui/DeliveryMetrics";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../ui/primitives";
import { CAMPAIGN_STATUS_LABEL, LANGUAGE_LABEL } from "../../ui/labels";
export const dynamic = "force-dynamic";
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; page?: string }> }) {
  await requirePageCapability(Capability.VIEW_CRM, "/reports");
  const query = await searchParams;
  let report; let problem = "";
  try { report = await getDeliveryReport({ ...query, page: Number(query.page) }); }
  catch (error) {
    if (!(error instanceof Error) || !/date/.test(error.message)) throw error;
    problem = error.message; report = await getDeliveryReport();
  }
  const pageUrl = (page: number) => `/reports?${new URLSearchParams({ from: report.range.fromLabel, to: report.range.toLabel, page: String(page) })}`;
  return <>
    <PageHeader title="Reports" description="From submission to engagement. See what happened to each newsletter." actions={<Link href="/operations" className={buttonSecondary}>View operations</Link>}/>
    <Card className="mb-5 p-5"><form className="flex flex-wrap items-end gap-4"><label className="grid gap-2 text-xs font-semibold text-slate-600">Campaigns created from (UTC)<input type="date" name="from" className={inputClass} defaultValue={report.range.fromLabel}/></label><label className="grid gap-2 text-xs font-semibold text-slate-600">Through (UTC)<input type="date" name="to" className={inputClass} defaultValue={report.range.toLabel}/></label><button className={buttonSecondary}>Apply dates</button><span className="pb-2 text-xs text-slate-500">All observed outcomes for newsletters created in this period.</span></form>{problem && <p role="alert" className="mt-3 text-sm text-rose-700">{problem}</p>}</Card>
    <DeliveryMetrics metrics={report.metrics} unsubscribed={report.unsubscribed}/>
    {report.unmatched > 0 && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{report.unmatched} verified provider events are waiting for an exact delivery match across the workspace. Address-level opt-outs and suppressions already apply.</p>}
    <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="font-semibold">Newsletter performance</h2><span className="text-xs text-slate-500">{report.total.toLocaleString()} newsletters</span></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Newsletter", "Status", "Accepted", "Delivered", "Opened", "Clicked"].map(label => <th key={label} className="whitespace-nowrap px-5 py-3 text-start font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{report.campaigns.map(row => <tr key={row.id}><td className="min-w-56 px-5 py-4"><Link href={`/reports/${row.id}`} className="font-semibold text-slate-900 hover:text-sky-700" dir="auto">{row.name}</Link><p className="mt-1 text-xs text-slate-500">{LANGUAGE_LABEL[row.language]} · {row.createdAt.toISOString().slice(0,10)}</p></td><td className="px-5 py-4"><Badge>{CAMPAIGN_STATUS_LABEL[row.status]}</Badge></td>{["accepted","delivered","opened","clicked"].map(key => <td className="px-5 py-4 tabular-nums" key={key}>{(row.metrics?.[key as "accepted"] ?? 0).toLocaleString()}</td>)}</tr>)}{!report.campaigns.length && <tr><td colSpan={6} className="p-12 text-center text-slate-500">No newsletters were created in this period. Change the dates to explore earlier work.</td></tr>}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5"><span className="text-xs text-slate-500">Page {report.page} of {report.pages}</span><div className="flex gap-3">{report.page>1 && <Link href={pageUrl(report.page-1)} className={buttonSecondary}>Previous</Link>}{report.page<report.pages && <Link href={pageUrl(report.page+1)} className={buttonSecondary}>Next</Link>}</div></div></Card>
  </>;
}
