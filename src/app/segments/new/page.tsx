import Link from "next/link";

import { emptySegmentDefinition } from "../../../domain/segment/segmentDefinition";
import { findPreset } from "../../../domain/segment/segmentPresets";
import { getLookupOptions } from "../../../server/services/segmentService";
import { SegmentBuilder } from "../../../ui/SegmentBuilder";
import { PageHeader, buttonSecondary } from "../../../ui/primitives";
import { previewAudienceAction, saveSegmentAction } from "../actions";
import { Capability, requirePageCapability } from "../../../server/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "New audience — AXIS" };

export default async function NewSegmentPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_SEGMENTS, "/segments/new");
  const { preset: presetKey } = await searchParams;
  const preset = presetKey ? findPreset(presetKey) : undefined;
  const lookups = await getLookupOptions();

  return (
    <div className="space-y-6">
      <PageHeader
        title="New audience"
        description="Choose the conditions, then preview exactly who would be emailed before you save."
        actions={
          <Link href="/segments" className={buttonSecondary}>
            Back to audiences
          </Link>
        }
      />

      <SegmentBuilder
        saveAction={saveSegmentAction}
        previewAction={previewAudienceAction}
        lookups={lookups}
        initial={preset?.definition ?? emptySegmentDefinition()}
        initialName={preset?.name ?? ""}
        initialDescription={preset?.description ?? ""}
      />
    </div>
  );
}
