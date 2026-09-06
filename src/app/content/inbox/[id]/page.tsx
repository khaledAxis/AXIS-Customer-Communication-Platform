import Link from "next/link";
import { notFound } from "next/navigation";

import { Capability, requirePageCapability } from "../../../../server/auth/session";
import { getReviewItem } from "../../../../server/services/contentReviewService";
import { getArticleTranslationStatus } from "../../../../server/services/articleTranslationService";
import { ArticleTranslationPanel } from "../../../../ui/ArticleTranslationPanel";
import { ArticleBodyPreview } from "../../../../ui/ArticleBodyPreview";
import { BidiText } from "../../../../ui/BidiText";
import { articleDirection } from "../../../../domain/content/inlineDirection";
import {
  Badge,
  Card,
  PageHeader,
  buttonSecondary,
  inputClass,
} from "../../../../ui/primitives";
import {
  approveContentAction,
  importImageAction,
  rejectContentAction,
  returnToInboxAction,
  saveEditorialAction,
} from "../actions";

/**
 * Reviewing one article.
 *
 * The page is split in two on purpose, and the split is the point (ADR-0026):
 *
 *   WHAT THE SOURCE SAID   — read-only. The publisher's words, mirrored. Editing it
 *                            here would be rewriting somebody else's article.
 *   WHAT AXIS WILL SAY     — editable. AXIS's own headline, summary and call to
 *                            action, stored in their own columns so a later
 *                            re-collection refreshes the left side and never touches
 *                            the right.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Review article — AXIS" };

const STATE: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Not used", tone: "neutral" },
  PENDING_REVIEW: { label: "Waiting for review", tone: "warning" },
  NEW: { label: "Waiting for review", tone: "warning" },
};

export default async function ReviewArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    approved?: string;
    rejected?: string;
    returned?: string;
    imported?: string;
    error?: string;
  }>;
}) {
  await requirePageCapability(Capability.MANAGE_CONTENT, "/content/inbox");
  const { id } = await params;
  const feedback = await searchParams;

  const item = await getReviewItem(id);
  if (!item) notFound();
  const translation = await getArticleTranslationStatus(id);
  const dir = articleDirection(item.language);

  const state = STATE[item.reviewState] ?? { label: item.reviewState, tone: "neutral" as const };
  const isApproved = item.reviewState === "APPROVED";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review article"
        description="Decide whether this belongs in an AXIS newsletter, and write AXIS's own words for it."
        actions={
          <Link href="/content/inbox" className={buttonSecondary}>
            Back to inbox
          </Link>
        }
      />

      {feedback.saved ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Your words were saved.</p>
        </div>
      ) : null}
      {feedback.approved ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Approved. It can now be put into a newsletter — nothing has been sent.
          </p>
        </div>
      ) : null}
      {feedback.rejected ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Marked as not used.</p>
        </div>
      ) : null}
      {feedback.returned ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Put back in the inbox.</p>
        </div>
      ) : null}
      {feedback.imported ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Picture copied into AXIS storage, so it stays available in the newsletter.
          </p>
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={state.tone}>{state.label}</Badge>
        {item.reviewedBy ? (
          <span className="text-xs text-slate-500">
            Last decision by {item.reviewedBy.name ?? item.reviewedBy.email}
            {item.reviewedAt
              ? ` · ${new Date(item.reviewedAt).toLocaleString("en-GB")}`
              : ""}
          </span>
        ) : null}
      </div>

      {translation.eligible && translation.source && <ArticleTranslationPanel key={translation.sourceRef} id={id} configured={translation.configuration.configured} message={translation.configuration.message} latest={translation.latest} source={translation.source} />}
      {translation.original && <Card className="p-5"><p className="font-semibold text-sky-900">Hebrew translation — review the wording before approval</p><Link href={`/content/${id}/edit`} className="mt-2 inline-block text-sm font-semibold text-sky-700 underline">Compare with the original and edit the Hebrew article</Link></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- source information (read-only) ---------------- */}
        <Card className="p-5">
          <h2 className="text-base font-bold text-slate-900">{translation.original ? "Prepared Hebrew draft" : "What the source said"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {translation.original ? "This is a prepared Hebrew version. Compare it with the original and review its accuracy before approval." : <>Collected from {item.source?.name ?? item.sourceName ?? "an unknown source"}. This is the publisher&rsquo;s own text and is not edited here.</>}
          </p>

          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Title
              </dt>
              <dd dir={dir} className="mt-0.5 font-semibold text-slate-900"><BidiText text={item.title} dir={dir} /></dd>
            </div>

            {item.summary ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Excerpt
                </dt>
                <dd dir={dir} className="mt-0.5 text-slate-700"><BidiText text={item.summary} dir={dir} /></dd>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Author
                </dt>
                <dd className="mt-0.5 text-slate-700">{item.author ?? "Not given"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Published
                </dt>
                <dd className="mt-0.5 text-slate-700">
                  {item.publishedAt
                    ? new Date(item.publishedAt).toLocaleDateString("en-GB")
                    : "No date"}
                </dd>
              </div>
            </div>

            {item.externalUrl ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Original article
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={item.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    dir="ltr"
                    className="break-all font-mono text-xs text-sky-700 underline hover:text-sky-900"
                  >
                    {item.externalUrl}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {item.bodyText && <div className="mt-5"><ArticleBodyPreview source={item.bodyText} baseUrl={item.externalUrl} dir={dir} /></div>}

          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            Feed collection keeps a title, short excerpt and source link. It does not fetch
            the full webpage. Staff can add article text in the editor before translating.
          </p>

          {item.imageUrl ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Picture
              </p>
              <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- external
                  thumbnail of unknown dimensions, shown for review only. */}
              <img
                src={item.imageUrl}
                alt={item.imageAlt ?? ""}
                className="mt-2 max-h-48 rounded-md border border-slate-200 object-cover"
              />
              {item.imageAlt && <figcaption dir={dir} className="mt-2 text-start text-sm text-slate-600"><BidiText text={item.imageAlt} dir={dir} /></figcaption>}
              </figure>
              {!item.imageUrl.startsWith("/api/media/") &&
              !item.imageUrl.includes("cloudinary") ? (
                <form action={importImageAction} className="mt-2">
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Copy this picture into AXIS storage
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    Recommended before using it in a newsletter — otherwise the picture
                    disappears if the publisher moves it.
                  </p>
                </form>
              ) : null}
            </div>
          ) : null}
        </Card>

        {/* ---------------- AXIS editorial copy ---------------- */}
        <Card className="p-5">
          <h2 className="text-base font-bold text-slate-900">What AXIS will say</h2>
          <p className="mt-1 text-sm text-slate-600">
            Your own words for the newsletter. Leave a field empty to use the
            source&rsquo;s version.
          </p>

          <form action={saveEditorialAction} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={item.id} />

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">AXIS headline</span>
              <input
                name="axisHeadline"
                dir={item.language === "HE" || item.language === "AR" ? "rtl" : "auto"}
                defaultValue={item.axisHeadline ?? ""}
                placeholder={item.title}
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">AXIS summary</span>
              <textarea
                name="axisSummary"
                dir={item.language === "HE" || item.language === "AR" ? "rtl" : "auto"}
                rows={4}
                defaultValue={item.axisSummary ?? ""}
                placeholder="Why this matters to AXIS customers."
                className={inputClass}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-semibold text-slate-800">Button text</span>
                <input
                  name="ctaLabel"
                  defaultValue={item.ctaLabel ?? ""}
                  placeholder="Read more"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-slate-800">Button link</span>
                <input
                  name="ctaUrl"
                  dir="ltr"
                  defaultValue={item.ctaUrl ?? ""}
                  placeholder={item.externalUrl ?? "https://…"}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">
                Internal note{" "}
                <span className="font-normal text-slate-500">(never sent to anyone)</span>
              </span>
              <textarea
                name="internalNote"
                rows={2}
                defaultValue={item.internalNote ?? ""}
                className={inputClass}
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Save AXIS copy
            </button>
            <p className="text-xs text-slate-500">
              Saving is not approving. It changes nothing about whether this article can
              be used.
            </p>
          </form>
        </Card>
      </div>

      {/* ---------------- the decision ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Decision</h2>
        <p className="mt-1 text-sm text-slate-600">
          Approving makes this article available when building a newsletter. It does not
          send anything and does not choose who would receive it.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {!isApproved ? (
            <form action={approveContentAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="from" value="detail" />
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Approve for newsletters
              </button>
            </form>
          ) : null}

          {item.reviewState !== "REJECTED" ? (
            <form action={rejectContentAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="from" value="detail" />
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Not for us
              </button>
            </form>
          ) : null}

          {item.reviewState !== "PENDING_REVIEW" ? (
            <form action={returnToInboxAction}>
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Put back in the inbox
              </button>
            </form>
          ) : null}
        </div>

        {item.campaignLinks.length > 0 ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Used in
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {item.campaignLinks.map((link) => (
                <li key={link.campaign.id}>
                  <Link
                    href={`/newsletters/${link.campaign.id}`}
                    className="text-sky-700 underline hover:text-sky-900"
                  >
                    {link.campaign.name}
                  </Link>{" "}
                  <span className="text-xs text-slate-500">({link.campaign.status})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
