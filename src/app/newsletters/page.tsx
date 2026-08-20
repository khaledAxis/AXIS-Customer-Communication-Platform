import Link from "next/link";

import { listNewsletters } from "../../server/services/newsletterService";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  LANGUAGE_LABEL,
  SEND_MODE_LABEL,
  formatDate,
} from "../../ui/labels";
import { Badge, Card, EmptyState, PageHeader, buttonPrimary, buttonSubtle } from "../../ui/primitives";
import { deleteNewsletterAction, duplicateNewsletterAction } from "./actions";
import { Capability, requirePageCapability } from "../../server/auth/session";

export const dynamic = "force-dynamic";

export default async function NewslettersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_NEWSLETTERS, "/newsletters");
  const { error } = await searchParams;
  const newsletters = await listNewsletters();

  return (
    <>
      <PageHeader
        title="Newsletters"
        description="Build a newsletter from your approved articles, then preview exactly how it will look."
        actions={
          <Link href="/newsletters/new" className={buttonPrimary}>
            Create a newsletter
          </Link>
        }
      />

      {error ? (
        <div role="alert" className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">{error}</p>
        </div>
      ) : null}

      {newsletters.length === 0 ? (
        <EmptyState
          icon="✉️"
          title="No newsletters yet"
          description="Create your first newsletter, add a few approved articles, and preview how it will look on a computer and a phone."
          actionHref="/newsletters/new"
          actionLabel="Create a newsletter"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-start">
                  {["Newsletter", "Subject line", "Language", "Status", "Articles", "Updated", ""].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {newsletters.map((newsletter) => (
                  <tr key={newsletter.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/newsletters/${newsletter.id}`}
                        className="font-semibold text-slate-900 hover:text-sky-700 hover:underline"
                      >
                        {newsletter.name}
                      </Link>
                      <div className="mt-1">
                        <Badge tone={newsletter.sendMode === "TEST" ? "warning" : "danger"}>
                          {SEND_MODE_LABEL[newsletter.sendMode] ?? newsletter.sendMode}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {newsletter.subject ?? <span className="text-slate-400">Not set</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {LANGUAGE_LABEL[newsletter.language] ?? newsletter.language}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={CAMPAIGN_STATUS_TONE[newsletter.status] ?? "neutral"}>
                        {CAMPAIGN_STATUS_LABEL[newsletter.status] ?? newsletter.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {newsletter._count.contentLinks}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(newsletter.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link href={`/newsletters/${newsletter.id}`} className={buttonSubtle}>
                          Edit
                        </Link>
                        <Link href={`/newsletters/${newsletter.id}/preview`} className={buttonSubtle}>
                          Preview
                        </Link>
                        <form action={duplicateNewsletterAction}>
                          <input type="hidden" name="id" value={newsletter.id} />
                          <button type="submit" className={buttonSubtle}>
                            Duplicate
                          </button>
                        </form>
                        {newsletter._count.recipients + newsletter._count.events + newsletter._count.testSends ===
                        0 ? (
                          <form action={deleteNewsletterAction}>
                            <input type="hidden" name="id" value={newsletter.id} />
                            <button type="submit" className={buttonSubtle}>
                              Delete
                            </button>
                          </form>
                        ) : (
                          <span
                            title="This newsletter has sending history and is kept permanently."
                            className="text-xs text-slate-400"
                          >
                            Kept
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
