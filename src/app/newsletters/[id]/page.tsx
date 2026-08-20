import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaignAudience } from "../../../server/services/campaignAudienceService";
import { listApprovedContent } from "../../../server/services/contentService";
import { getNewsletter } from "../../../server/services/newsletterService";
import { listSegments } from "../../../server/services/segmentService";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  LANGUAGE_LABEL,
  REVIEW_STATE_LABEL,
} from "../../../ui/labels";
import { CampaignAudienceSection } from "../../../ui/CampaignAudienceSection";
import { NewsletterDetailsForm } from "../../../ui/NewsletterDetailsForm";
import {
  Badge,
  Card,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  buttonSubtle,
} from "../../../ui/primitives";
import {
  addContentAction,
  moveContentDownAction,
  moveContentUpAction,
  removeContentAction,
  setCampaignSegmentAction,
  snapshotAudienceAction,
  updateNewsletterAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function NewsletterBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const newsletter = await getNewsletter(id);
  if (!newsletter) notFound();

  const [approved, audience, segments] = await Promise.all([
    listApprovedContent(newsletter.language),
    getCampaignAudience(newsletter.id, { withPreview: true }),
    listSegments(),
  ]);
  const chosenIds = new Set(newsletter.contentLinks.map((link) => link.contentItemId));
  const available = approved.filter((item) => !chosenIds.has(item.id));
  const rtl = newsletter.language === "HE" || newsletter.language === "AR";

  return (
    <>
      <PageHeader
        title={newsletter.name}
        description="Choose the articles you want to include and put them in the right order."
        actions={
          <>
            <Badge tone={CAMPAIGN_STATUS_TONE[newsletter.status] ?? "neutral"}>
              {CAMPAIGN_STATUS_LABEL[newsletter.status] ?? newsletter.status}
            </Badge>
            <Badge tone="warning">Test mode</Badge>
            <Link href={`/newsletters/${newsletter.id}/preview`} className={buttonPrimary}>
              Preview email
            </Link>
            <Link
              href={`/newsletters/${newsletter.id}/readiness`}
              className={buttonSecondary}
            >
              Send readiness
            </Link>
            <Link href="/newsletters" className={buttonSecondary}>
              All newsletters
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------------- Composition ---------------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Articles in this newsletter ({newsletter.contentLinks.length})
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  They appear in the email in the order shown here.
                </p>
              </div>
            </div>

            {newsletter.contentLinks.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
                <p className="text-sm font-semibold text-slate-800">No articles yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
                  Add approved articles from the list on the right to build your newsletter.
                </p>
              </div>
            ) : (
              <ol className="space-y-3">
                {newsletter.contentLinks.map((link, index) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-start gap-4 rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">
                      {index + 1}
                    </span>

                    {link.contentItem.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- served from our media route
                      <img
                        src={link.contentItem.imageUrl}
                        alt=""
                        className="h-16 w-24 shrink-0 rounded-md border border-slate-200 object-cover"
                      />
                    ) : null}

                    <div className="min-w-[12rem] flex-1">
                      <p dir={rtl ? "rtl" : "ltr"} className="font-semibold text-slate-900">
                        {link.contentItem.title}
                      </p>
                      {link.contentItem.summary ? (
                        <p
                          dir={rtl ? "rtl" : "ltr"}
                          className="mt-1 line-clamp-2 text-sm text-slate-600"
                        >
                          {link.contentItem.summary}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone="info">{LANGUAGE_LABEL[link.contentItem.language]}</Badge>
                        {link.contentItem.origin === "INGESTED" &&
                        link.contentItem.reviewState !== "APPROVED" ? (
                          <Badge tone="danger">
                            External · {REVIEW_STATE_LABEL[link.contentItem.reviewState]}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <form action={moveContentUpAction}>
                        <input type="hidden" name="campaignId" value={newsletter.id} />
                        <input type="hidden" name="contentItemId" value={link.contentItemId} />
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label={`Move ${link.contentItem.title} up`}
                          className={buttonSubtle}
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moveContentDownAction}>
                        <input type="hidden" name="campaignId" value={newsletter.id} />
                        <input type="hidden" name="contentItemId" value={link.contentItemId} />
                        <button
                          type="submit"
                          disabled={index === newsletter.contentLinks.length - 1}
                          aria-label={`Move ${link.contentItem.title} down`}
                          className={buttonSubtle}
                        >
                          ↓
                        </button>
                      </form>
                      <form action={removeContentAction}>
                        <input type="hidden" name="campaignId" value={newsletter.id} />
                        <input type="hidden" name="contentItemId" value={link.contentItemId} />
                        <button type="submit" className={buttonSubtle}>
                          Remove
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-bold text-slate-900">Newsletter details</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              The subject line and preview text your customers will see.
            </p>
            <NewsletterDetailsForm
              action={updateNewsletterAction}
              submitLabel="Save details"
              compact
              values={{
                id: newsletter.id,
                name: newsletter.name,
                subject: newsletter.subject,
                preheader: newsletter.preheader,
                language: newsletter.language,
              }}
            />
          </Card>
        </div>

        {/* ---------------- Available content ---------------- */}
        <div>
          <Card className="p-6">
            <h2 className="text-lg font-bold text-slate-900">Approved articles</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              Only approved articles can be added. Written in {LANGUAGE_LABEL[newsletter.language]} or
              with no language set.
            </p>

            {available.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                {approved.length === 0 ? (
                  <>
                    You have no approved articles yet.{" "}
                    <Link href="/content" className="font-semibold text-sky-700 hover:underline">
                      Go to Content
                    </Link>{" "}
                    to write and approve one.
                  </>
                ) : (
                  "Every approved article is already in this newsletter."
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {available.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                    <p dir={rtl ? "rtl" : "ltr"} className="text-sm font-semibold text-slate-900">
                      {item.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge tone="info">{LANGUAGE_LABEL[item.language]}</Badge>
                      <form action={addContentAction}>
                        <input type="hidden" name="campaignId" value={newsletter.id} />
                        <input type="hidden" name="contentItemId" value={item.id} />
                        <button type="submit" className={buttonSubtle}>
                          Add
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {audience ? (
        <div className="mt-6">
          <CampaignAudienceSection
            audience={audience}
            segments={segments}
            editable={newsletter.status === "DRAFT"}
            setSegmentAction={setCampaignSegmentAction}
            snapshotAction={snapshotAudienceAction}
          />
        </div>
      ) : null}
    </>
  );
}
