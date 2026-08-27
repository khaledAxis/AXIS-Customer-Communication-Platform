import Link from "next/link";

import { Capability, requirePageCapability } from "../../../../server/auth/session";
import {
  getReviewBoard,
  type QaCheckStatus,
} from "../../../../server/services/qaReviewService";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../../../ui/primitives";
import { recordReviewAction } from "./actions";

/**
 * Manual rendering review of the QA messages that were already sent (ADR-0030).
 *
 * Reviewing is looking at an inbox and writing down what you saw. This page therefore
 * sends nothing and has no control that could: no recipient selector, no send button,
 * no scenario picker. It reads the durable QA ledger and records verdicts beside it.
 *
 * `NOT CHECKED` is the default and is shown as such — a checklist nobody has filled in
 * must never read as clean.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "QA rendering review — AXIS" };

const STATUS_TONE: Record<QaCheckStatus, "success" | "danger" | "neutral"> = {
  PASS: "success",
  FAIL: "danger",
  NOT_CHECKED: "neutral",
};

const STATUS_LABEL: Record<QaCheckStatus, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NOT_CHECKED: "Not checked",
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "COSMETIC"] as const;

export default async function QaReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePageCapability(Capability.SEND_TEST_EMAIL, "/admin/qa-email/review");
  const feedback = await searchParams;
  const board = await getReviewBoard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="QA rendering review"
        description="Record what you actually saw in the inbox for each QA message that was already sent. Nothing on this page sends or resends anything."
        actions={
          <Link href="/admin/qa-email" className={buttonSecondary}>
            Back to QA email
          </Link>
        }
      />

      {feedback.saved ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Review saved.</p>
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      {/* ---------------- progress ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Review progress</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Messages
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {board.totals.messages}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Checks passed
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">
              {board.totals.passed}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Checks failed
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-700">{board.totals.failed}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Not checked
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-500">
              {board.totals.notChecked}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          These are the messages that were already sent. Reviewing them consumes no QA
          quota and sends nothing — open the inbox, look, and record what you see.
          Anything left as <strong>Not checked</strong> stays not checked; it is never
          counted as a pass.
        </p>
      </Card>

      {/* ---------------- per recipient ---------------- */}
      {board.byRecipient.map((group) => (
        <Card key={group.recipient} className="p-5">
          <h2 className="font-mono text-sm font-bold text-slate-900">
            {group.recipient}
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {group.messages.length} message{group.messages.length === 1 ? "" : "s"}
          </p>

          <div className="mt-4 space-y-5">
            {group.messages.map((message) => (
              <div
                key={message.sendId}
                id={message.sendId}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900">
                      {message.scenarioTitle}
                    </h3>
                    <p className="mt-0.5 break-words text-xs text-slate-600">
                      {message.subject}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {message.purpose}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      tone={
                        message.summary.failed > 0
                          ? "danger"
                          : message.summary.notChecked === 0
                            ? "success"
                            : "neutral"
                      }
                    >
                      {message.summary.passed}/{message.summary.total} passed
                    </Badge>
                    {message.worstSeverity ? (
                      <span className="text-[11px] font-bold uppercase text-rose-700">
                        {message.worstSeverity}
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className="mt-2 break-all font-mono text-[11px] text-slate-400">
                  {message.providerMessageId ?? "no provider id"}
                  {message.acceptedAt
                    ? ` · accepted ${new Date(message.acceptedAt).toLocaleString("en-GB")}`
                    : ""}
                  {message.ledgerRecovered ? " · recovered record" : ""}
                </p>

                <ul className="mt-3 space-y-3">
                  {message.checks.map((check) => (
                    <li
                      key={check.checkKey}
                      className="rounded-md border border-slate-100 bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-slate-800">{check.label}</span>
                        <Badge tone={STATUS_TONE[check.status]}>
                          {STATUS_LABEL[check.status]}
                        </Badge>
                      </div>

                      {check.note ? (
                        <p className="mt-1 text-xs text-slate-600">{check.note}</p>
                      ) : null}
                      {check.reviewedByEmail && check.reviewedAt ? (
                        <p className="mt-1 text-[11px] text-slate-400">
                          {check.reviewedByEmail} ·{" "}
                          {new Date(check.reviewedAt).toLocaleString("en-GB")}
                        </p>
                      ) : null}

                      <form
                        action={recordReviewAction}
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="sendId" value={message.sendId} />
                        <input type="hidden" name="checkKey" value={check.checkKey} />

                        <label className="text-xs">
                          <span className="block font-semibold text-slate-700">
                            Verdict
                          </span>
                          <select
                            name="status"
                            defaultValue={check.status}
                            className={inputClass}
                          >
                            <option value="NOT_CHECKED">Not checked</option>
                            <option value="PASS">Pass</option>
                            <option value="FAIL">Fail</option>
                          </select>
                        </label>

                        <label className="text-xs">
                          <span className="block font-semibold text-slate-700">
                            Severity <span className="font-normal">(if failed)</span>
                          </span>
                          <select
                            name="severity"
                            defaultValue={check.severity ?? ""}
                            className={inputClass}
                          >
                            <option value="">—</option>
                            {SEVERITIES.map((severity) => (
                              <option key={severity} value={severity}>
                                {severity}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="min-w-[12rem] flex-1 text-xs">
                          <span className="block font-semibold text-slate-700">
                            Note <span className="font-normal">(optional)</span>
                          </span>
                          <input
                            name="note"
                            defaultValue={check.note ?? ""}
                            placeholder="What did you see?"
                            className={inputClass}
                          />
                        </label>

                        <button
                          type="submit"
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          Save
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {board.byRecipient.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-800">
            No QA messages to review
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Messages appear here once a QA email has been sent.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
