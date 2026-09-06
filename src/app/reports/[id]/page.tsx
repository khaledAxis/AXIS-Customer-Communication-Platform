import Link from "next/link";
import { notFound } from "next/navigation";
import { Capability, requirePageCapability } from "../../../server/auth/session";
import { getCampaignReport } from "../../../server/services/reportService";
import { DELIVERY_LABELS } from "../../../domain/delivery/reporting";
import { EXCLUSION_REASON_LABEL, CAMPAIGN_STATUS_LABEL } from "../../../ui/labels";
import { DeliveryMetrics } from "../../../ui/DeliveryMetrics";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../../ui/primitives";
export const dynamic = "force-dynamic";
const stamp = (date: Date | null) => date ? date.toISOString().slice(0, 16).replace("T", " ") : "—";
export default async function CampaignReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; state?: string }>;
}) {
  await requirePageCapability(Capability.VIEW_CRM, "/reports");
  const { id } = await params; const query = await searchParams;
  const report = await getCampaignReport(id, Number(query.page), query.state);
  if (!report) notFound();
  const { campaign, metrics } = report;
  const pageUrl = (page: number) => `/reports/${id}?${new URLSearchParams({ page: String(page), state: report.state })}`;
  return <>
    <PageHeader title={campaign.name} description="Delivery history and observed engagement. All timestamps are UTC." actions={<>
      <Link href="/reports" className={buttonSecondary}>All reports</Link><a href={`/api/reports/${id}/export`} className={buttonSecondary}>Export recipient CSV</a>
    </>}/>
    <div className="mb-5 flex flex-wrap items-center gap-3"><Badge>{CAMPAIGN_STATUS_LABEL[campaign.status]}</Badge><span className="text-sm text-slate-600" dir="auto">{campaign.subject}</span>
      <Link href={`/newsletters/${id}/readiness`} className="ms-auto text-sm font-semibold text-sky-700">Review delivery →</Link></div>
    <DeliveryMetrics metrics={metrics} unsubscribed={report.unsubscribed}/>
    {metrics.uncertain > 0 && <Card className="mb-5 border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-900">Submission needs reconciliation</h2><p className="mt-1 text-sm text-amber-900">The provider may have received {metrics.uncertain} messages. These destinations will never be automatically submitted again.</p></Card>}
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><h2 className="font-semibold">Recipient outcomes <span className="ms-2 text-sm font-normal text-slate-500">{report.total.toLocaleString()}</span></h2>
        <form className="flex gap-2"><label className="sr-only" htmlFor="delivery-state">Delivery status</label><select id="delivery-state" name="state" defaultValue={report.state} className={inputClass}><option value="">All outcomes</option>{Object.entries(DELIVERY_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><button className={buttonSecondary}>Filter</button></form></div>
      <div className="overflow-x-auto"><table className="w-full text-start text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Destination", "Outcome", "Accepted", "Delivered", "First open", "First click"].map(label => <th className="whitespace-nowrap px-5 py-3 text-start font-semibold" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{report.recipients.map(row => <tr key={row.id}>
        <td className="px-5 py-4" dir="ltr">{row.normalizedEmail}</td><td className="px-5 py-4"><Badge tone={row.state === "UNCERTAIN" ? "warning" : row.state === "DELIVERED" ? "success" : "neutral"}>{DELIVERY_LABELS[row.state]}</Badge>{row.vetoReason && <p className="mt-1 text-xs text-slate-500">{EXCLUSION_REASON_LABEL[row.vetoReason]}</p>}</td>
        {[row.sentAt, row.deliveredAt, row.firstOpenedAt, row.firstClickedAt].map((date,i) => <td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-slate-500" key={i}>{stamp(date)}</td>)}</tr>)}
        {!report.recipients.length && <tr><td colSpan={6} className="p-10 text-center text-slate-500">No delivery records match this view.</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-slate-100 p-5"><span className="text-xs text-slate-500">Page {report.page} of {report.pages} · 100 destinations per page</span><div className="flex gap-3">{report.page>1 && <Link className={buttonSecondary} href={pageUrl(report.page-1)}>Previous</Link>}{report.page<report.pages && <Link className={buttonSecondary} href={pageUrl(report.page+1)}>Next</Link>}</div></div>
    </Card>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><Card className="p-5"><h2 className="font-semibold">Daily activity</h2><p className="mt-1 text-xs text-slate-500">Unique recipients per day, latest 90 active days. Daily counts are not additive across days.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["UTC date", "Delivered", "Opened", "Clicked"].map(label => <th className="py-2 text-start text-xs text-slate-500" key={label}>{label}</th>)}</tr></thead><tbody>{report.daily.map(row => <tr key={row.day} className="border-t border-slate-100"><td className="py-3">{row.day}</td><td>{row.delivered}</td><td>{row.opened}</td><td>{row.clicked}</td></tr>)}</tbody></table>{!report.daily.length && <p className="py-6 text-sm text-slate-500">Activity will appear when verified provider events arrive.</p>}</div></Card>
      <Card className="p-5"><h2 className="font-semibold">Latest provider events</h2><p className="mt-1 text-xs text-slate-500">Most recent 50 verified events. Repeated activity does not inflate unique recipient counts.</p><ol className="mt-4 max-h-96 overflow-y-auto divide-y divide-slate-100">{report.events.map(event => <li className="flex flex-wrap justify-between gap-2 py-3 text-xs" key={event.id}><div><strong className="font-semibold">{({ ACCEPTED: "Accepted", DELIVERED: "Delivered", OPENED: "Opened", CLICKED: "Clicked", BOUNCE: "Bounced", COMPLAINT: "Spam complaint", UNSUBSCRIBE: "Unsubscribed", FAILED: "Failed", DEFERRED: "Deferred" } as Record<string,string>)[event.type] ?? "Provider event"}</strong><p className="mt-1 break-all text-slate-500" dir="ltr">{event.normalizedEmail}</p></div><time className="text-slate-500">{stamp(event.occurredAt)}</time></li>)}</ol>{!report.events.length && <p className="py-6 text-sm text-slate-500">No provider events recorded yet.</p>}</Card></div>
  </>;
}
