import Link from "next/link";

import { SEGMENT_PRESETS } from "../../domain/segment/segmentPresets";
import { listSegments } from "../../server/services/segmentService";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
} from "../../ui/primitives";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Audiences — AXIS" };

export default async function SegmentsPage() {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_SEGMENTS, "/segments");
  const segments = await listSegments();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audiences"
        description="Decide who a newsletter goes to, using the customer information synced from Monday."
        actions={
          <Link href="/segments/new" className={buttonPrimary}>
            New audience
          </Link>
        }
      />

      {segments.length === 0 ? (
        <EmptyState
          title="No audiences yet"
          description="An audience is a set of conditions — for example every GPS customer who owns a Trimble product. Start from one of the examples below, or build your own."
          actionHref="/segments/new"
          actionLabel="Create your first audience"
          icon="🎯"
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {segments.map((segment) => (
              <li key={segment.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/segments/${segment.id}`}
                      className="text-base font-semibold text-slate-900 hover:text-sky-700"
                    >
                      {segment.name}
                    </Link>
                    {segment.description ? (
                      <p className="mt-0.5 text-sm text-slate-600">
                        {segment.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      {segment.conditionCount === 0
                        ? "No conditions — selects everyone"
                        : `${segment.conditionCount} condition${segment.conditionCount === 1 ? "" : "s"}`}
                      {segment.campaignCount > 0
                        ? ` · used by ${segment.campaignCount} newsletter${segment.campaignCount === 1 ? "" : "s"}`
                        : null}
                    </p>
                    {segment.problem ? (
                      <p className="mt-1 text-xs font-medium text-rose-700">
                        {segment.problem}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {segment.campaignCount > 0 ? (
                      <Badge tone="info">In use</Badge>
                    ) : null}
                    <Link
                      href={`/segments/${segment.id}`}
                      className={buttonSecondary}
                    >
                      Open
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Start from an example</h2>
        <p className="mt-1 text-sm text-slate-600">
          These are starting points, not rules — you can change everything before
          saving.
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {SEGMENT_PRESETS.map((preset) => (
            <li
              key={preset.key}
              className="rounded-lg border border-slate-200 p-3.5"
            >
              <p className="text-sm font-semibold text-slate-900">{preset.name}</p>
              <p className="mt-0.5 text-xs text-slate-600">{preset.description}</p>
              <Link
                href={`/segments/new?preset=${preset.key}`}
                className="mt-2 inline-block text-sm font-semibold text-sky-700 hover:text-sky-900"
              >
                Use this →
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
