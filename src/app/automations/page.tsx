import Link from "next/link";

import { Card, PageHeader, buttonSecondary } from "../../ui/primitives";

export default function AutomationsPage() {
  return (
    <>
      <PageHeader
        title="Automations"
        description="Have a newsletter draft prepared for you automatically, every week or every month."
        actions={
          <Link href="/newsletters" className={buttonSecondary}>
            Go to Newsletters
          </Link>
        }
      />

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
            Coming later
          </span>
          <h2 className="text-lg font-bold text-slate-900">Not switched on yet</h2>
        </div>

        <p className="mt-3 max-w-2xl text-slate-600">
          When this is enabled, AXIS will prepare a newsletter <strong>draft</strong> for you on a
          schedule so you never start from a blank page.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-bold text-emerald-900">What it will do</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-emerald-900">
              <li>• Create a draft newsletter on a weekly or monthly schedule</li>
              <li>• Gather suggested articles for you to look at</li>
              <li>• Wait for you to choose what goes in</li>
            </ul>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <h3 className="text-sm font-bold text-rose-900">What it will never do</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-rose-900">
              <li>• Send an email on its own</li>
              <li>• Choose external articles without a person approving them</li>
              <li>• Skip the approval step</li>
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}
