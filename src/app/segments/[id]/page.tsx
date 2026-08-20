import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getLookupOptions,
  getSegment,
} from "../../../server/services/segmentService";
import { SegmentBuilder } from "../../../ui/SegmentBuilder";
import { CAMPAIGN_STATUS_LABEL } from "../../../ui/labels";
import {
  Card,
  PageHeader,
  buttonDanger,
  buttonSecondary,
} from "../../../ui/primitives";
import {
  deleteSegmentAction,
  duplicateSegmentAction,
  previewAudienceAction,
  saveSegmentAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SegmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const [segment, lookups] = await Promise.all([getSegment(id), getLookupOptions()]);
  if (!segment) notFound();

  const inUse = segment.campaigns.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={segment.name}
        description={segment.description ?? undefined}
        actions={
          <>
            <Link href="/segments" className={buttonSecondary}>
              Back to audiences
            </Link>
            <form action={duplicateSegmentAction}>
              <input type="hidden" name="id" value={segment.id} />
              <button type="submit" className={buttonSecondary}>
                Duplicate
              </button>
            </form>
            {inUse ? null : (
              <form action={deleteSegmentAction}>
                <input type="hidden" name="id" value={segment.id} />
                <button type="submit" className={buttonDanger}>
                  Delete
                </button>
              </form>
            )}
          </>
        }
      />

      {error === "in-use" ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">
            This audience is used by a newsletter, so it cannot be deleted.
          </p>
        </div>
      ) : null}

      {segment.problem ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">
            The saved conditions could not be read, so the builder below starts
            empty.
          </p>
          <p className="mt-1 text-sm text-rose-700">{segment.problem}</p>
        </div>
      ) : null}

      {inUse ? (
        <Card>
          <h2 className="text-sm font-semibold text-slate-800">
            Used by these newsletters
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {segment.campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/newsletters/${campaign.id}`}
                  className="font-medium text-sky-700 hover:text-sky-900"
                >
                  {campaign.name}
                </Link>
                <span className="ms-2 text-xs text-slate-500">
                  {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Changing the conditions changes who those newsletters would reach, because
            the audience is recalculated every time it is used.
          </p>
        </Card>
      ) : null}

      <SegmentBuilder
        saveAction={saveSegmentAction}
        previewAction={previewAudienceAction}
        lookups={lookups}
        initial={segment.definition}
        segmentId={segment.id}
        initialName={segment.name}
        initialDescription={segment.description ?? ""}
      />
    </div>
  );
}
