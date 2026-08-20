import { countContentByState } from "../../server/services/contentService";
import { countCampaignsByStatus } from "../../server/services/newsletterService";
import { Card, PageHeader } from "../../ui/primitives";
import { CAMPAIGN_STATUS_LABEL, REVIEW_STATE_LABEL } from "../../ui/labels";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.VIEW_CRM, "/reports");
  const [contentCounts, campaignCounts] = await Promise.all([
    countContentByState(),
    countCampaignsByStatus(),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Delivery and engagement figures will appear here once newsletters are actually sent."
      />

      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
            Test mode
          </span>
          <h2 className="text-lg font-bold text-slate-900">Nothing has been sent yet</h2>
        </div>
        <p className="mt-3 max-w-2xl text-slate-600">
          Opens, clicks, bounces and unsubscribes are recorded from real deliveries. Because no email
          has been sent, there is nothing to report. What you can see today is the state of your own
          content and newsletters.
        </p>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-base font-bold text-slate-900">Articles</h2>
          <dl className="mt-4 space-y-2">
            {Object.keys(REVIEW_STATE_LABEL).map((state) => (
              <div
                key={state}
                className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0"
              >
                <dt className="text-sm text-slate-600">{REVIEW_STATE_LABEL[state]}</dt>
                <dd className="text-sm font-bold tabular-nums text-slate-900">
                  {contentCounts[state] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-bold text-slate-900">Newsletters</h2>
          <dl className="mt-4 space-y-2">
            {Object.keys(CAMPAIGN_STATUS_LABEL).map((status) => (
              <div
                key={status}
                className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0"
              >
                <dt className="text-sm text-slate-600">{CAMPAIGN_STATUS_LABEL[status]}</dt>
                <dd className="text-sm font-bold tabular-nums text-slate-900">
                  {campaignCounts[status] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-bold text-slate-900">Delivery</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {["Emails sent", "Opened", "Clicked", "Unsubscribed"].map((metric) => (
            <div key={metric} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-2xl font-bold tabular-nums text-slate-400">0</div>
              <div className="mt-1 text-xs font-semibold text-slate-600">{metric}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
