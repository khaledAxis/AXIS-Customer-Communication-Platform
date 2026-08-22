import Link from "next/link";

import { Capability, requirePageCapability } from "../../../server/auth/session";
import {
  countInbox,
  listInbox,
  type ReviewFilter,
} from "../../../server/services/contentReviewService";
import { listSources } from "../../../server/services/contentSourceService";
import { Card, PageHeader, buttonSecondary, inputClass } from "../../../ui/primitives";
import { checkSourcesAction } from "../../sources/actions";
import { InboxList } from "../../../ui/InboxList";

/**
 * The review inbox — where collected articles wait for a person.
 *
 * Everything on this page is waiting. Nothing here has been published, nothing has
 * been emailed, and nothing will be until somebody approves it and then, separately,
 * builds and sends a newsletter.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Review inbox — AXIS" };

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: "NEW", label: "Waiting for review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Not used" },
  { value: "ALL", label: "Everything" },
];

export default async function ContentInboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    source?: string;
    category?: string;
    search?: string;
    since?: string;
    approved?: string;
    rejected?: string;
    error?: string;
  }>;
}) {
  await requirePageCapability(Capability.MANAGE_CONTENT, "/content/inbox");
  const query = await searchParams;

  const filter = (FILTERS.find((f) => f.value === query.filter)?.value ??
    "NEW") as ReviewFilter;

  const [items, counts, sources] = await Promise.all([
    listInbox({
      filter,
      sourceId: query.source ?? null,
      category: query.category ?? null,
      search: query.search ?? null,
      since: query.since ?? null,
    }),
    countInbox(),
    listSources(),
  ]);

  const categories = Array.from(
    new Set(sources.flatMap((source) => source.categories)),
  ).sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review inbox"
        description="Articles collected from your sources. Nothing here has been published or emailed — approve the ones worth sharing, and they become available for a newsletter."
        actions={
          <>
            <form action={checkSourcesAction}>
              <button type="submit" className={buttonSecondary}>
                Check sources now
              </button>
            </form>
            <Link href="/sources" className={buttonSecondary}>
              Sources
            </Link>
          </>
        }
      />

      {query.approved ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Approved. It can now be put into a newsletter — nothing has been sent.
          </p>
        </div>
      ) : null}
      {query.rejected ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">
            Marked as not used. You can change your mind later.
          </p>
        </div>
      ) : null}
      {query.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{query.error}</p>
        </div>
      ) : null}

      {/* ---------------- counts ---------------- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Waiting for review
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{counts.waiting}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Approved
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{counts.approved}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Not used
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-500">{counts.rejected}</p>
        </Card>
      </div>

      {/* ---------------- filters ---------------- */}
      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <label className="text-sm sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Show
            </span>
            <select name="filter" defaultValue={filter} className={inputClass}>
              {FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Source
            </span>
            <select name="source" defaultValue={query.source ?? ""} className={inputClass}>
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Label
            </span>
            <select name="category" defaultValue={query.category ?? ""} className={inputClass}>
              <option value="">Any label</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Published since
            </span>
            <input
              type="date"
              name="since"
              defaultValue={query.since ?? ""}
              className={inputClass}
            />
          </label>

          <label className="text-sm sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="Title or summary"
              className={inputClass}
            />
          </label>

          <div className="sm:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Apply
            </button>
            <Link
              href="/content/inbox"
              className="ms-3 text-sm font-semibold text-slate-600 underline hover:text-slate-800"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {/* ---------------- the articles ---------------- */}
      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-800">Nothing here yet</p>
          <p className="mt-1 text-sm text-slate-600">
            {filter === "NEW"
              ? "No articles are waiting. Press “Check sources now” to look for new ones — that is not an error, it usually just means nothing new has been published."
              : "No articles match these filters."}
          </p>
        </Card>
      ) : (
        <InboxList
          filter={filter}
          items={items.map((item) => ({
            id: item.id,
            title: item.title,
            axisHeadline: item.axisHeadline,
            summary: item.summary,
            sourceName: item.source?.name ?? item.sourceName,
            externalUrl: item.externalUrl,
            imageUrl: item.imageUrl,
            publishedAt: item.publishedAt?.toISOString() ?? null,
            reviewState: item.reviewState,
            usedInNewsletters: item._count.campaignLinks,
          }))}
        />
      )}

      {items.length > 0 ? (
        <p className="text-center text-xs text-slate-500">
          Approving an article makes it available for a newsletter. It does not send
          anything, and it does not choose who would receive it.
        </p>
      ) : null}
    </div>
  );
}
