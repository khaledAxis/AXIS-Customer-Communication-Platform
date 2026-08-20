import Link from "next/link";

import type { CampaignAudienceView } from "../server/services/campaignAudienceService";
import type { SegmentSummary } from "../server/services/segmentService";
import { AudiencePreviewPanel } from "./AudiencePreviewPanel";
import { LANGUAGE_LABEL } from "./labels";
import { Card, buttonPrimary, buttonSecondary } from "./primitives";

/**
 * Audience selection on the newsletter builder.
 *
 * Everything here is planning. Choosing an audience and recording a snapshot
 * create no delivery recipients and send nothing — the wording says so, because
 * "who will receive this" is exactly the screen where someone could assume
 * otherwise.
 */
export function CampaignAudienceSection({
  audience,
  segments,
  editable,
  setSegmentAction,
  snapshotAction,
}: {
  audience: CampaignAudienceView;
  segments: SegmentSummary[];
  editable: boolean;
  setSegmentAction: (formData: FormData) => Promise<void>;
  snapshotAction: (formData: FormData) => Promise<void>;
}) {
  const localized = audience.language === "HE" || audience.language === "AR";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Who will receive this
          </h2>
          <Link
            href="/segments"
            className="text-sm font-semibold text-sky-700 hover:text-sky-900"
          >
            Manage audiences →
          </Link>
        </div>

        <p className="mt-1 text-sm text-slate-600">
          {localized ? (
            <>
              This is a <strong>{LANGUAGE_LABEL[audience.language]}</strong>{" "}
              newsletter, so only addresses set to that language are included.
            </>
          ) : (
            "This newsletter is not tied to a language, so addresses in any language are included."
          )}
        </p>

        {segments.length === 0 ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            No audiences exist yet.{" "}
            <Link
              href="/segments/new"
              className="font-semibold text-sky-700 hover:underline"
            >
              Create one
            </Link>{" "}
            to choose who this newsletter is for.
          </p>
        ) : (
          <form action={setSegmentAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="campaignId" value={audience.campaignId} />
            <label className="block">
              <span className="block text-sm font-semibold text-slate-800">
                Audience
              </span>
              <select
                name="segmentId"
                // Remount when the saved audience changes: an uncontrolled select
                // keeps its old DOM value across a re-render and would show the
                // previous choice after saving.
                key={audience.segment?.id ?? "none"}
                defaultValue={audience.segment?.id ?? ""}
                disabled={!editable}
                className="mt-2 block w-72 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">No audience chosen</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonSecondary} disabled={!editable}>
              Save audience
            </button>
          </form>
        )}

        {!editable ? (
          <p className="mt-2 text-xs text-slate-500">
            The audience is locked because this newsletter is no longer a draft.
          </p>
        ) : null}

        {audience.lastSnapshot ? (
          <p className="mt-3 text-xs text-slate-500">
            Last recorded on{" "}
            {audience.lastSnapshot.resolvedAt.toLocaleString("en-GB")}:{" "}
            {audience.lastSnapshot.uniqueDestinations.toLocaleString()} addresses,{" "}
            {audience.lastSnapshot.excluded.toLocaleString()} excluded. The audience
            is recalculated every time — a send would use fresh figures, never these.
          </p>
        ) : null}

        {audience.segment && editable ? (
          <form action={snapshotAction} className="mt-3">
            <input type="hidden" name="campaignId" value={audience.campaignId} />
            <button type="submit" className={buttonPrimary}>
              Record this audience
            </button>
            <span className="ms-3 text-xs text-slate-500">
              Saves the current figures for review. Still sends nothing.
            </span>
          </form>
        ) : null}
      </Card>

      {audience.preview ? (
        <AudiencePreviewPanel
          preview={audience.preview}
          title={`Audience: ${audience.segment?.name ?? ""}`}
        />
      ) : null}
    </div>
  );
}
