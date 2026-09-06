import Link from "next/link";
import { notFound } from "next/navigation";

import { getContent } from "../../../../server/services/contentService";
import { getArticleTranslationStatus } from "../../../../server/services/articleTranslationService";
import { ArticleTranslationPanel } from "../../../../ui/ArticleTranslationPanel";
import { ContentForm } from "../../../../ui/ContentForm";
import { ArticleBodyPreview } from "../../../../ui/ArticleBodyPreview";
import { BidiText } from "../../../../ui/BidiText";
import { articleDirection } from "../../../../domain/content/inlineDirection";
import { REVIEW_STATE_LABEL, REVIEW_STATE_TONE } from "../../../../ui/labels";
import { Badge, PageHeader, buttonSubtle } from "../../../../ui/primitives";
import { deleteContentAction, setReviewStateAction, updateContentAction } from "../../actions";
import { Capability, requirePageCapability } from "../../../../server/auth/session";

export const dynamic = "force-dynamic";

export default async function EditContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_CONTENT, "/content");
  const { id } = await params;
  const { saved } = await searchParams;
  const item = await getContent(id);
  if (!item) notFound();
  const translation = await getArticleTranslationStatus(id);
  const originalDir = articleDirection(translation.original?.language);

  return (
    <>
      <PageHeader
        title="Edit article"
        description="Changes here never affect newsletters that were already sent — those keep their own frozen copy."
        actions={
          <>
            <Badge tone={REVIEW_STATE_TONE[item.reviewState] ?? "neutral"}>
              {REVIEW_STATE_LABEL[item.reviewState] ?? item.reviewState}
            </Badge>
            {item.reviewState !== "APPROVED" ? (
              <form action={setReviewStateAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="reviewState" value="APPROVED" />
                <button type="submit" className={buttonSubtle}>
                  Approve
                </button>
              </form>
            ) : null}
            <form action={deleteContentAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className={buttonSubtle}>
                Delete
              </button>
            </form>
            <Link href="/content" className={buttonSubtle}>
              Back to Content
            </Link>
          </>
        }
      />

      {saved ? (
        <div role="status" className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">
            Article saved. Approve it when you are ready to use it in a newsletter.
          </p>
        </div>
      ) : null}

      {translation.eligible && translation.source && <div className="mb-6"><ArticleTranslationPanel key={translation.sourceRef} id={id} configured={translation.configuration.configured} message={translation.configuration.message} latest={translation.latest} source={translation.source} /></div>}
      {translation.original && <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-5">
        <h2 className="font-bold text-sky-950">Hebrew translation — review before approval</h2>
        <p className="mt-1 text-sm text-slate-700">Compare the original with the Hebrew fields below. Check technical meaning, names and measurements before approving this draft.</p>
        {translation.original.changedSinceTranslation && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The original article has changed since this translation was prepared. Compare the current source below or request a fresh Hebrew draft from the original article.</p>}
        <details className="mt-3 rounded-lg border border-sky-100 bg-white p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-sky-900">Original article for comparison</summary>
          <h3 dir={originalDir} className="mt-3 font-semibold"><BidiText text={translation.original.title} dir={originalDir} /></h3>
          <p dir={originalDir} className="mt-2 text-sm leading-relaxed text-slate-600"><BidiText text={translation.original.summary ?? ""} dir={originalDir} /></p>
          {translation.original.bodyText && <div className="mt-3 max-h-64 overflow-auto"><ArticleBodyPreview source={translation.original.bodyText} dir={originalDir} label="Original article preview" /></div>}
          <Link href={`/content/inbox/${translation.original.id}`} className="mt-3 inline-block text-sm font-semibold text-sky-700 underline">Open original article</Link>
        </details>
      </section>}
      <ContentForm
        action={updateContentAction}
        submitLabel="Save changes"
        savedMessage="Your changes have been saved."
        values={{
          id: item.id,
          title: item.title,
          summary: item.summary,
          body: item.bodyText,
          language: item.language,
          origin: item.origin,
          sourceName: item.sourceName,
          author: item.author,
          externalUrl: item.externalUrl,
          imageUrl: item.imageUrl,
          imageAlt: item.imageAlt,
          publishedAt: item.publishedAt,
        }}
      />
    </>
  );
}
