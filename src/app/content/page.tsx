import Link from "next/link";

import { listContent } from "../../server/services/contentService";
import type { ContentFilter } from "../../server/db/repositories/contentRepository";
import {
  LANGUAGE_LABEL,
  ORIGIN_LABEL,
  REVIEW_STATE_LABEL,
  REVIEW_STATE_TONE,
  formatDate,
} from "../../ui/labels";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonPrimary,
  buttonSubtle,
} from "../../ui/primitives";
import { setReviewStateAction } from "./actions";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

const FILTERS: { value: ContentFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "Drafts" },
  { value: "PENDING_REVIEW", label: "Needs review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "INTERNAL", label: "Written by AXIS" },
  { value: "INGESTED", label: "External" },
  { value: "HE", label: "Hebrew" },
  { value: "AR", label: "Arabic" },
  { value: "UNKNOWN", label: "Language not set" },
];

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; error?: string }>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_CONTENT, "/content");
  const params = await searchParams;
  const active = (FILTERS.find((f) => f.value === params.filter)?.value ?? "ALL") as ContentFilter;
  const items = await listContent(active);

  return (
    <>
      <PageHeader
        title="Content"
        description="Articles you can put into a newsletter. Only approved articles can be added."
        actions={
          <Link href="/content/new" className={buttonPrimary}>
            Write an article
          </Link>
        }
      />

      {params.error ? (
        <div role="alert" className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">{params.error}</p>
        </div>
      ) : null}

      <nav aria-label="Filter articles" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const isActive = filter.value === active;
          return (
            <Link
              key={filter.value}
              href={filter.value === "ALL" ? "/content" : `/content?filter=${filter.value}`}
              aria-current={isActive ? "true" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon="📝"
          title={active === "ALL" ? "No articles yet" : "Nothing matches this filter"}
          description={
            active === "ALL"
              ? "Write your first article and it will appear here, ready to add to a newsletter."
              : "Try a different filter, or write a new article."
          }
          actionHref="/content/new"
          actionLabel="Write an article"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const rtl = item.language === "HE" || item.language === "AR";
            return (
              <Card key={item.id} className="flex flex-col overflow-hidden">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served from our media route
                  <img
                    src={item.imageUrl}
                    alt={item.imageAlt ?? ""}
                    className="h-40 w-full border-b border-slate-200 object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="grid h-40 w-full place-items-center border-b border-slate-100 bg-slate-50 text-3xl text-slate-300"
                  >
                    🖼️
                  </div>
                )}

                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge tone={REVIEW_STATE_TONE[item.reviewState] ?? "neutral"}>
                      {REVIEW_STATE_LABEL[item.reviewState] ?? item.reviewState}
                    </Badge>
                    <Badge tone="info">{LANGUAGE_LABEL[item.language] ?? item.language}</Badge>
                  </div>

                  <h2
                    dir={rtl ? "rtl" : "ltr"}
                    className="text-base font-bold leading-snug text-slate-900"
                  >
                    {item.title}
                  </h2>

                  {item.summary ? (
                    <p
                      dir={rtl ? "rtl" : "ltr"}
                      className="mt-2 line-clamp-3 text-sm text-slate-600"
                    >
                      {item.summary}
                    </p>
                  ) : null}

                  <dl className="mt-4 space-y-1 text-xs text-slate-500">
                    <div className="flex gap-1.5">
                      <dt className="font-semibold">Origin:</dt>
                      <dd>{ORIGIN_LABEL[item.origin] ?? item.origin}</dd>
                    </div>
                    {item.sourceName || item.source?.name ? (
                      <div className="flex gap-1.5">
                        <dt className="font-semibold">Source:</dt>
                        <dd>{item.sourceName ?? item.source?.name}</dd>
                      </div>
                    ) : null}
                    {item.publishedAt ? (
                      <div className="flex gap-1.5">
                        <dt className="font-semibold">Published:</dt>
                        <dd>{formatDate(item.publishedAt)}</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                    <Link href={`/content/${item.id}/edit`} className={buttonSubtle}>
                      Edit
                    </Link>

                    {item.reviewState !== "APPROVED" ? (
                      <form action={setReviewStateAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="reviewState" value="APPROVED" />
                        <button type="submit" className={buttonSubtle}>
                          Approve
                        </button>
                      </form>
                    ) : null}

                    {item.reviewState !== "REJECTED" ? (
                      <form action={setReviewStateAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="reviewState" value="REJECTED" />
                        <button type="submit" className={buttonSubtle}>
                          Reject
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
