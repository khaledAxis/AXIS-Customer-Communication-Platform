import Link from "next/link";
import { notFound } from "next/navigation";

import { getContent } from "../../../../server/services/contentService";
import { ContentForm } from "../../../../ui/ContentForm";
import { REVIEW_STATE_LABEL, REVIEW_STATE_TONE } from "../../../../ui/labels";
import { Badge, PageHeader, buttonSubtle } from "../../../../ui/primitives";
import { deleteContentAction, setReviewStateAction, updateContentAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const item = await getContent(id);
  if (!item) notFound();

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
