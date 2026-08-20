import Link from "next/link";

import { countContentByState } from "../server/services/contentService";
import { countCampaignsByStatus } from "../server/services/newsletterService";
import { Card, PageHeader, buttonPrimary, buttonSecondary } from "../ui/primitives";
import { requirePage } from "../server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Dashboard — a plain-language overview of where things stand.
 *
 * Reads through services (never Prisma directly), per the layer rules.
 */
export default async function DashboardPage() {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePage("/");
  const [contentCounts, campaignCounts] = await Promise.all([
    countContentByState(),
    countCampaignsByStatus(),
  ]);

  const approved = contentCounts.APPROVED ?? 0;
  const needsReview = (contentCounts.PENDING_REVIEW ?? 0) + (contentCounts.NEW ?? 0);
  const drafts = campaignCounts.DRAFT ?? 0;
  const totalNewsletters = Object.values(campaignCounts).reduce((sum, n) => sum + n, 0);

  const stats = [
    { label: "Articles ready to use", value: approved, hint: "Approved and available for a newsletter" },
    { label: "Articles needing attention", value: needsReview, hint: "Drafts and items waiting for review" },
    { label: "Newsletters in progress", value: drafts, hint: "Drafts you can still edit" },
    { label: "Newsletters in total", value: totalNewsletters, hint: "All newsletters ever created" },
  ];

  return (
    <>
      <PageHeader
        title="Welcome to AXIS Communication"
        description="Write articles, build a newsletter, and preview exactly how it will look — all before a single email is ever sent."
        actions={
          <>
            <Link href="/content/new" className={buttonSecondary}>
              Write an article
            </Link>
            <Link href="/newsletters/new" className={buttonPrimary}>
              Create a newsletter
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="text-3xl font-bold tabular-nums text-slate-900">{stat.value}</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{stat.label}</div>
            <div className="mt-1 text-xs text-slate-500">{stat.hint}</div>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-lg font-bold text-slate-900">How it works</h2>
          <ol className="mt-4 space-y-4">
            {[
              {
                title: "Write your articles",
                body: "Add a title, a short summary, the text, and a picture. Each article can be in Hebrew or Arabic.",
                href: "/content",
                cta: "Go to Content",
              },
              {
                title: "Approve what you want to send",
                body: "Only approved articles can be added to a newsletter, so nothing goes out by accident.",
                href: "/content",
                cta: "Review articles",
              },
              {
                title: "Build the newsletter",
                body: "Pick several articles, put them in the order you want, and write the subject line.",
                href: "/newsletters",
                cta: "Go to Newsletters",
              },
              {
                title: "Preview it",
                body: "See exactly how the email will look on a computer and on a phone before anything is sent.",
                href: "/newsletters",
                cta: "Open a preview",
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                  {index + 1}
                </span>
                <div>
                  <div className="font-semibold text-slate-900">{step.title}</div>
                  <p className="mt-0.5 text-sm text-slate-600">{step.body}</p>
                  <Link
                    href={step.href}
                    className="mt-1 inline-block text-sm font-semibold text-sky-700 hover:underline"
                  >
                    {step.cta} →
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-bold text-slate-900">Safety</h2>
          <p className="mt-2 text-sm text-slate-600">
            The system is in <strong>test mode</strong>. This is deliberate.
          </p>
          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            {[
              "No email can be sent to customers.",
              "Test emails may only go to one authorised address.",
              "Customer data from Monday.com is not connected yet.",
              "Every newsletter starts as a private draft.",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden className="text-emerald-600">
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
