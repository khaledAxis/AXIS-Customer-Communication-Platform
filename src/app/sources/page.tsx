import Link from "next/link";

import { Capability, requirePageCapability } from "../../server/auth/session";
import { listSources } from "../../server/services/contentSourceService";
import { can } from "../../domain/auth/authorization";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../ui/primitives";
import {
  checkSourcesAction,
  createSourceAction,
  setSourceEnabledAction,
} from "./actions";

/**
 * Content sources — where AXIS newsletter articles come from.
 *
 * Everyone who manages content can SEE this page and press "Check sources now".
 * Only an administrator can add or change a source, because a source is a URL this
 * server will fetch, and that is an infrastructure decision (ADR-0026). The form is
 * simply absent for a manager — and the service refuses regardless, which is the
 * check that actually matters.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Content sources — AXIS" };

const KIND_LABEL: Record<string, string> = {
  RSS: "RSS feed",
  ATOM: "Atom feed",
  MANUAL_EXTERNAL: "Added by hand",
  WEBSITE: "Website",
  API: "API",
  INTERNAL: "Written at AXIS",
};

function when(value: Date | null | undefined): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Never";
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    checked?: string;
    message?: string;
    error?: string;
  }>;
}) {
  const actor = await requirePageCapability(Capability.MANAGE_CONTENT, "/sources");
  const feedback = await searchParams;
  const sources = await listSources();
  const mayEdit = can(actor, Capability.MANAGE_CONTENT_SOURCES);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content sources"
        description="The websites AXIS collects articles from. Collecting an article never publishes it — everything arrives in the review inbox and waits for a person."
        actions={
          <Link href="/content/inbox" className={buttonSecondary}>
            Go to review inbox
          </Link>
        }
      />

      {feedback.checked ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            {feedback.message ?? "Sources checked."}
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            Nothing was sent. New articles are waiting in the review inbox.
          </p>
        </div>
      ) : null}
      {feedback.created ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Source added.</p>
        </div>
      ) : null}
      {feedback.updated ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Source updated.</p>
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Check for new articles</h2>
            <p className="mt-1 text-sm text-slate-600">
              Reads every enabled source and adds anything new to the review inbox.
              No email is sent, and nothing is approved.
            </p>
          </div>
          <form action={checkSourcesAction}>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Check sources now
            </button>
          </form>
        </div>
      </Card>

      {/* ---------------- the sources ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">
          Sources ({sources.length})
        </h2>

        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No sources yet.{" "}
            {mayEdit
              ? "Add the address of a manufacturer or industry news feed below."
              : "An administrator can add one."}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {sources.map((source) => {
              const lastRun = source.ingestionRuns[0];
              return (
                <li key={source.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{source.name}</h3>
                        <Badge tone={source.isEnabled ? "success" : "neutral"}>
                          {source.isEnabled ? "Enabled" : "Paused"}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {KIND_LABEL[source.kind] ?? source.kind}
                        </span>
                      </div>
                      {source.feedUrl ? (
                        <p
                          dir="ltr"
                          className="mt-1 truncate font-mono text-xs text-slate-500"
                        >
                          {source.feedUrl}
                        </p>
                      ) : null}
                      {source.categories.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {source.categories.join(" · ")}
                        </p>
                      ) : null}
                    </div>

                    {mayEdit ? (
                      <form action={setSourceEnabledAction} className="shrink-0">
                        <input type="hidden" name="id" value={source.id} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={source.isEnabled ? "no" : "yes"}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          {source.isEnabled ? "Pause" : "Enable"}
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="font-semibold uppercase tracking-wide text-slate-500">
                        Last checked
                      </dt>
                      <dd className="mt-0.5 text-slate-700">{when(source.lastCheckedAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold uppercase tracking-wide text-slate-500">
                        Last successful
                      </dt>
                      <dd className="mt-0.5 text-slate-700">{when(source.lastSucceededAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold uppercase tracking-wide text-slate-500">
                        Articles collected
                      </dt>
                      <dd className="mt-0.5 text-slate-700">{source._count.items}</dd>
                    </div>
                  </dl>

                  {source.lastErrorMessage ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {/* Friendly diagnostics only — never a stack trace. */}
                      Last check did not work: {source.lastErrorMessage}
                    </p>
                  ) : lastRun ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Last check: {lastRun.createdCount} new of {lastRun.discoveredCount}{" "}
                      found.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------------- add a source (ADMIN only) ---------------- */}
      {mayEdit ? (
        <Card className="p-5">
          <h2 className="text-base font-bold text-slate-900">Add a source</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste the address of the site&rsquo;s RSS or Atom feed — usually something
            ending in <code className="font-mono text-xs">/feed</code> or{" "}
            <code className="font-mono text-xs">/rss.xml</code>. Only public websites
            can be used.
          </p>

          <form action={createSourceAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-semibold text-slate-800">Name</span>
              <input name="name" required className={inputClass} placeholder="Manufacturer news" />
            </label>

            <label className="text-sm">
              <span className="font-semibold text-slate-800">Type</span>
              <select name="kind" className={inputClass} defaultValue="RSS">
                <option value="RSS">RSS feed</option>
                <option value="ATOM">Atom feed</option>
                <option value="MANUAL_EXTERNAL">Added by hand (not fetched)</option>
              </select>
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="font-semibold text-slate-800">Feed address</span>
              <input
                name="feedUrl"
                dir="ltr"
                className={inputClass}
                placeholder="https://example.com/feed"
              />
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="font-semibold text-slate-800">
                Website <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <input
                name="baseUrl"
                dir="ltr"
                className={inputClass}
                placeholder="https://example.com"
              />
            </label>

            <label className="text-sm">
              <span className="font-semibold text-slate-800">Language of the articles</span>
              <select name="language" className={inputClass} defaultValue="UNKNOWN">
                <option value="UNKNOWN">Not sure</option>
                <option value="HE">Hebrew</option>
                <option value="AR">Arabic</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="font-semibold text-slate-800">
                Labels <span className="font-normal text-slate-500">(comma separated)</span>
              </span>
              <input name="categories" className={inputClass} placeholder="hardware, mapping" />
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Add source
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-slate-600">
            Adding or changing a source is an administrator task, because a source is an
            address this server will fetch. Ask an administrator to add one — you can
            still check for new articles and review everything that arrives.
          </p>
        </Card>
      )}
    </div>
  );
}
