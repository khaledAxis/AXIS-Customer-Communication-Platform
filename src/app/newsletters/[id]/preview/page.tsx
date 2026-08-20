import Link from "next/link";
import { notFound } from "next/navigation";

import { getNewsletterPreview } from "../../../../server/services/newsletterService";
import { getPilotStatus } from "../../../../server/services/providerPilotService";
import { getTestSendStatus } from "../../../../server/services/testSendService";
import { EmailPreview } from "../../../../ui/EmailPreview";
import { LANGUAGE_LABEL } from "../../../../ui/labels";
import { Badge, Card, PageHeader, buttonSecondary } from "../../../../ui/primitives";
import { ProviderPilotPanel } from "../../../../ui/ProviderPilotPanel";
import { TestSendPanel } from "../../../../ui/TestSendPanel";
import { Capability, requirePageCapability } from "../../../../server/auth/session";

export const dynamic = "force-dynamic";

const READINESS_MESSAGE: Record<string, string> = {
  NO_CONTENT: "This newsletter has no articles in it yet.",
  UNAPPROVED_EXTERNAL_CONTENT:
    "It contains an external article that has not been approved yet. Approve it before sending.",
  MISSING_SNAPSHOT: "The final copy of the content has not been frozen yet.",
};

export default async function NewsletterPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    approved?: string;
    sent?: string;
    error?: string;
    message?: string;
    revoked?: string;
    pilotApproved?: string;
    pilotRevoked?: string;
    pilotSent?: string;
  }>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_NEWSLETTERS, "/newsletters");
  const { id } = await params;
  const feedback = await searchParams;
  const [preview, testSend, pilot] = await Promise.all([
    getNewsletterPreview(id),
    getTestSendStatus(id),
    getPilotStatus(id),
  ]);
  if (!preview) notFound();

  const { document: doc, html, readiness, delivery } = preview;

  return (
    <>
      <PageHeader
        title="Preview"
        description="Exactly how this newsletter will look. Nothing is sent from this screen."
        actions={
          <>
            <Link href={`/newsletters/${id}`} className={buttonSecondary}>
              Back to editing
            </Link>
          </>
        }
      />

      <div
        role="status"
        className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
      >
        <span className="inline-flex items-center rounded-full bg-amber-200/80 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">
          Test mode
        </span>
        <span className="text-sm font-semibold text-amber-900">
          No email will be sent from this screen.
        </span>
      </div>

      {feedback.sent ? (
        <div role="status" className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            {feedback.message ?? "Gmail accepted the test email for delivery."}
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            Accepted for delivery is not the same as received. Check the {delivery.to} inbox to
            confirm it arrived.
          </p>
        </div>
      ) : null}

      {feedback.pilotSent ? (
        <div role="status" className="mb-6 rounded-lg border border-indigo-300 bg-indigo-50 p-4">
          <p className="text-sm font-semibold text-indigo-900">
            {feedback.message ?? "The provider accepted the pilot email for delivery."}
          </p>
          <p className="mt-1 text-xs text-indigo-800">
            Accepted for delivery is not the same as received. Check the{" "}
            {pilot?.toEmail ?? "internal"} inbox — including its spam folder, which is
            part of what a pilot is for.
          </p>
        </div>
      ) : null}

      {feedback.pilotApproved ? (
        <div role="status" className="mb-6 rounded-lg border border-indigo-300 bg-indigo-50 p-4">
          <p className="text-sm font-semibold text-indigo-900">
            Approved for one internal provider pilot.
          </p>
        </div>
      ) : null}

      {feedback.pilotRevoked ? (
        <div role="status" className="mb-6 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Pilot approval withdrawn.</p>
        </div>
      ) : null}

      {feedback.approved ? (
        <div role="status" className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Approved for one test send.</p>
        </div>
      ) : null}

      {feedback.revoked ? (
        <div role="status" className="mb-6 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Approval withdrawn.</p>
        </div>
      ) : null}

      {feedback.error ? (
        <div role="alert" className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EmailPreview html={html} />
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-base font-bold text-slate-900">What customers would see</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</dt>
                <dd className="mt-0.5 text-slate-900">
                  <span className="font-semibold">{delivery.senderName}</span>
                  <br />
                  <span className="font-mono text-xs">{delivery.from}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Replies go to
                </dt>
                <dd className="mt-0.5 font-mono text-slate-900">{delivery.replyTo}</dd>
                <p className="mt-1 text-xs text-slate-500">
                  Replies to this newsletter are not monitored.
                </p>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{doc.subject}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preview text
                </dt>
                <dd className="mt-0.5 text-slate-700">
                  {doc.preheader || <span className="text-slate-400">Not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Language</dt>
                <dd className="mt-0.5 text-slate-700">
                  {LANGUAGE_LABEL[doc.language]}{" "}
                  <span className="text-slate-400">
                    ({doc.language === "HE" || doc.language === "AR"
                      ? "right-to-left"
                      : "left-to-right"}
                    )
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Articles</dt>
                <dd className="mt-0.5 text-slate-700">{doc.items.length}</dd>
              </div>
            </dl>
          </Card>

          {/* ------- SAFE test send: approve, then send ------- */}
          {testSend ? (
            <TestSendPanel
              campaignId={id}
              fromEmail={testSend.fromEmail}
              senderName={testSend.senderName}
              replyToEmail={testSend.replyToEmail}
              toEmail={testSend.toEmail}
              subject={testSend.subject}
              canApprove={testSend.canApprove}
              canSend={testSend.canSend}
              message={testSend.message}
              providerConfigured={testSend.providerConfigured}
              providerProblems={testSend.providerProblems}
              approval={
                testSend.approval
                  ? {
                      approvedAt: testSend.approval.approvedAt.toISOString(),
                      approvedByEmail: testSend.approval.approvedByEmail,
                      valid: testSend.approval.valid,
                      reason: testSend.approval.reason,
                    }
                  : null
              }
              lastAttempt={
                testSend.lastAttempt
                  ? {
                      state: testSend.lastAttempt.state,
                      acceptedAt: testSend.lastAttempt.acceptedAt?.toISOString() ?? null,
                      message: testSend.lastAttempt.message,
                    }
                  : null
              }
            />
          ) : null}

          {/* ------- Internal provider pilot: the PRODUCTION transport, one address ------- */}
          {pilot ? (
            <ProviderPilotPanel
              campaignId={id}
              providerName={pilot.providerName}
              providerConfigured={pilot.providerConfigured}
              providerProblems={pilot.providerProblems}
              pilotModeEnabled={pilot.pilotModeEnabled}
              domainVerified={pilot.domainVerified}
              domain={pilot.domain}
              fromEmail={pilot.fromEmail}
              senderName={pilot.senderName}
              replyToEmail={pilot.replyToEmail}
              toEmail={pilot.toEmail}
              subject={pilot.subject}
              canApprove={pilot.canApprove}
              canSend={pilot.canSend}
              message={pilot.message}
              blockers={[...pilot.blockers]}
              approval={
                pilot.approval
                  ? {
                      approvedAt: pilot.approval.approvedAt.toISOString(),
                      approvedByEmail: pilot.approval.approvedByEmail,
                      valid: pilot.approval.valid,
                      reason: pilot.approval.reason,
                    }
                  : null
              }
              lastAttempt={
                pilot.lastAttempt
                  ? {
                      state: pilot.lastAttempt.state,
                      acceptedAt: pilot.lastAttempt.acceptedAt?.toISOString() ?? null,
                      providerMessageId: pilot.lastAttempt.providerMessageId,
                      message: pilot.lastAttempt.message,
                    }
                  : null
              }
            />
          ) : null}

          {testSend && testSend.omittedImageCount > 0 ? (
            <Card className="border-amber-200 bg-amber-50 p-5">
              <h2 className="text-base font-bold text-amber-900">
                {testSend.omittedImageCount === 1 ? "1 picture is" : `${testSend.omittedImageCount} pictures are`}{" "}
                left out
              </h2>
              <p className="mt-1 text-sm text-amber-900">
                They are stored on this computer, so the recipient could never load them. They are
                left out of the email entirely rather than arriving as a broken image — the preview
                above shows exactly what will be sent. Publishing pictures to a public web address is
                a separate step.
              </p>
            </Card>
          ) : null}

          {readiness.problems.length > 0 ? (
            <Card className="border-amber-200 bg-amber-50 p-5">
              <h2 className="text-base font-bold text-amber-900">Before this can be sent</h2>
              <ul className="mt-3 space-y-2 text-sm text-amber-900">
                {readiness.problems.map((problem) => (
                  <li key={problem} className="flex gap-2">
                    <span aria-hidden>•</span>
                    <span>{READINESS_MESSAGE[problem] ?? problem}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="border-emerald-200 bg-emerald-50 p-5">
              <p className="text-sm font-semibold text-emerald-900">
                The content of this newsletter is ready.
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                Sending still requires an email provider and an explicit approval step.
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-base font-bold text-slate-900">Recipients</h2>
            <p className="mt-1 text-sm text-slate-600">
              No customer list is connected yet, so this newsletter has no recipients. Customer data
              from Monday.com is not enabled.
            </p>
            <Badge tone="neutral">0 recipients</Badge>
          </Card>
        </div>
      </div>
    </>
  );
}
