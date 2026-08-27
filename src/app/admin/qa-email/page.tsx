import { Capability, requirePageCapability } from "../../../server/auth/session";
import {
  QA_SCENARIOS,
  getQaStatus,
  listQaSends,
} from "../../../server/services/qaEmailService";
import Link from "next/link";

import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../../ui/primitives";
import { getQaRunState } from "../../../server/services/qaRunService";
import { sendQaEmailAction } from "./actions";
import { closeQaRunAction, openQaRunAction } from "./runActions";

/**
 * Internal QA email (ADR-0027).
 *
 * The recipient control is a fixed `<select>` with exactly four options. There is no
 * "Other", no text input, and no way to type an address — but that is a courtesy, not
 * the control: the service and the transport adapter each re-validate the recipient
 * against the allowlist, so a crafted POST gets no further than a typed one.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "QA email — AXIS" };

export default async function QaEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    message?: string;
    error?: string;
    runOpened?: string;
    runClosed?: string;
  }>;
}) {
  await requirePageCapability(Capability.SEND_TEST_EMAIL, "/admin/qa-email");
  const feedback = await searchParams;
  const [status, sends, runState] = await Promise.all([
    getQaStatus(),
    listQaSends(),
    getQaRunState(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="QA email"
        description="Sends one internal test email to one of four approved AXIS addresses, to check how a newsletter actually renders in a real inbox. This is not customer sending."
        actions={
          <Link href="/admin/qa-email/review" className={buttonSecondary}>
            Rendering review
          </Link>
        }
      />

      {feedback.sent ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Gmail accepted the QA email for delivery.
          </p>
          <p className="mt-1 text-xs text-emerald-800">{feedback.message}</p>
          <p className="mt-1 text-xs text-emerald-800">
            Accepted is not the same as received — check the inbox to confirm.
          </p>
        </div>
      ) : null}
      {feedback.runOpened || feedback.runClosed ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">{feedback.message}</p>
        </div>
      ) : null}

      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      {runState.run === null ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">No QA run is open</p>
          <p className="mt-1 text-xs text-amber-900">
            {runState.lifetimeTotal > 0
              ? `${runState.lifetimeTotal} live QA email${runState.lifetimeTotal === 1 ? "" : "s"} have already been sent. Starting a new run does NOT reset the limits.`
              : "An administrator must start a run before any QA email can be sent."}
          </p>
        </div>
      ) : null}

      {/* ---------------- LIVE QA STATUS ---------------- */}
      <Card className="border-indigo-200 p-5">
        <h2 className="text-base font-bold text-slate-900">Live QA status</h2>

        <p className="mt-1 text-sm text-slate-600">
          Allowed recipients: <strong>{status.allowedRecipients.length}</strong>
          {runState.run ? (
            <>
              {" "}· Current run: <strong>{runState.run.label}</strong>
            </>
          ) : null}
        </p>

        <table className="mt-4 w-full text-left text-sm">
          <tbody>
            {runState.runPerRecipient.map((quota) => (
              <tr key={quota.recipient} className="border-b border-slate-100">
                <td className="py-2 font-mono text-xs text-slate-800">
                  {quota.recipient}
                </td>
                <td className="py-2 text-end tabular-nums">
                  <span
                    className={
                      quota.atLimit ? "font-bold text-rose-700" : "text-slate-700"
                    }
                  >
                    {quota.sent} / {quota.hardLimit}
                  </span>
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-2 text-sm font-bold text-slate-900">Total</td>
              <td className="py-2 text-end text-sm font-bold tabular-nums text-slate-900">
                {runState.lifetimeTotal} / {runState.hardTotal}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          These counts are every LIVE QA email ever sent, read from a durable ledger.
          They are not reset by a restart, by a test run, by toggling QA mode, or by
          starting a new run. Automated test fixtures are stored separately and can
          never change them.
        </p>

        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">
              Existing SAFE TEST
            </dt>
            <dd className="mt-0.5 font-semibold text-emerald-700">unchanged</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">
              Production customer sending
            </dt>
            <dd className="mt-0.5 font-semibold text-slate-800">disabled</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Every other address is refused by the server and again by the transport,
          before any connection is opened. Recipients are never taken from the CRM,
          from Monday, from a segment, or from an audience. There is no CC and no BCC.
        </p>
      </Card>

      {/* ---------------- run control (ADMIN) ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">QA run</h2>

        {runState.run ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {runState.run.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                Opened {new Date(runState.run.createdAt).toLocaleString("en-GB")}
                {runState.run.createdByEmail ? ` by ${runState.run.createdByEmail}` : ""}
                {" · "}
                {runState.runTotal} sent in this run
              </p>
            </div>
            <form action={closeQaRunAction}>
              <input type="hidden" name="runId" value={runState.run.id} />
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close run
              </button>
            </form>
          </div>
        ) : (
          <form action={openQaRunAction} className="mt-3 space-y-3">
            <label className="block text-sm">
              <span className="font-semibold text-slate-800">Name this QA run</span>
              <input
                name="label"
                required
                className={inputClass}
                placeholder="Rendering QA — August"
              />
            </label>

            {runState.requiresNewRunConfirmation ? (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <input
                  type="checkbox"
                  name="acknowledged"
                  value="yes"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 text-amber-700 focus:ring-amber-600"
                />
                <span className="text-xs leading-relaxed text-amber-900">
                  Previous live QA sends exist ({runState.lifetimeTotal}). I understand
                  that starting a new run <strong>does not reset the limits</strong> —
                  the per-recipient cap counts every live QA email ever sent.
                </span>
              </label>
            ) : null}

            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Start a new QA run
            </button>
            <p className="text-xs text-slate-500">
              Administrators only. A run is never started automatically.
            </p>
          </form>
        )}
      </Card>

      {/* ---------------- transport state ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Transport</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              QA mode
            </dt>
            <dd>
              <Badge tone={status.enabled ? "success" : "neutral"}>
                {status.enabled ? "Enabled" : "Off"}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sends from
            </dt>
            <dd className="font-mono text-xs text-slate-800">
              {status.senderEmail ?? "Not configured"}
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Replies go to
            </dt>
            <dd className="font-mono text-xs text-slate-800">
              {status.replyToEmail ?? "Not configured"}
            </dd>
          </div>
        </dl>
        {status.transportProblems.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-amber-900">
            {status.transportProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* ---------------- send one ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Send one QA email</h2>

        <form action={sendQaEmailAction} className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">QA recipient</span>
            {/* Exactly four options. No "Other", no free text, no multiple select. */}
            <select name="recipient" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Choose one of the four approved addresses
              </option>
              {status.allowedRecipients.map((address) => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-semibold text-slate-800">What to test</span>
            <select name="scenarioId" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Choose a test
              </option>
              {QA_SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.subject} — {scenario.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              name="confirm"
              value="yes"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-indigo-700 focus:ring-indigo-600"
            />
            <span className="text-xs leading-relaxed text-slate-700">
              I am sending <strong>one</strong> internal QA email to the selected AXIS
              address. The subject will begin with{" "}
              <strong className="font-mono">[AXIS Newsletter Platform TEST]</strong> so the
              recipient can see it is a platform test. No customer receives anything.
            </span>
          </label>

          <button
            type="submit"
            disabled={status.blockers.length > 0}
            title={status.blockers.length > 0 ? status.message : undefined}
            className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            Send QA Email
          </button>
          <p className="text-xs text-slate-600">{status.message}</p>
        </form>
      </Card>

      {/* ---------------- what has been sent ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">
          QA emails sent ({sends.length})
        </h2>
        {sends.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pe-3 font-semibold uppercase tracking-wide">When</th>
                  <th className="py-2 pe-3 font-semibold uppercase tracking-wide">To</th>
                  <th className="py-2 pe-3 font-semibold uppercase tracking-wide">Subject</th>
                  <th className="py-2 font-semibold uppercase tracking-wide">Result</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((send) => (
                  <tr key={send.id} className="border-b border-slate-100">
                    <td className="py-2 pe-3 tabular-nums text-slate-600">
                      {new Date(send.requestedAt).toLocaleString("en-GB")}
                    </td>
                    <td className="py-2 pe-3 font-mono text-slate-800">
                      {send.recipient}
                      {send.ledgerRecovered ? (
                        <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                          recovered
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3 text-slate-700">{send.subject}</td>
                    <td className="py-2">
                      <Badge
                        tone={
                          send.state === "ACCEPTED"
                            ? "success"
                            : send.state === "UNCERTAIN"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {send.state === "ACCEPTED" ? "Accepted" : send.state}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
