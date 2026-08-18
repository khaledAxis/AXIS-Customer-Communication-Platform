"use client";

import { useState } from "react";

import {
  approveTestSendAction,
  revokeTestApprovalAction,
  sendTestEmailAction,
} from "../app/newsletters/[id]/testSendActions";
import { Card } from "./primitives";

/**
 * Two-step SAFE TEST send panel: approve, then send.
 *
 * The addresses are read-only text — there is no input with which to name a different
 * recipient. The Send button is enabled only when the server says the approval is
 * valid for the exact content currently rendered.
 */

export interface TestSendPanelProps {
  campaignId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  canApprove: boolean;
  canSend: boolean;
  message: string;
  providerConfigured: boolean;
  providerProblems: string[];
  approval: {
    approvedAt: string;
    approvedByEmail: string | null;
    valid: boolean;
    reason?: string;
  } | null;
  lastAttempt: {
    state: string;
    acceptedAt: string | null;
    message: string | null;
  } | null;
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
        {value}
      </dd>
    </div>
  );
}

export function TestSendPanel(props: TestSendPanelProps) {
  const [confirmed, setConfirmed] = useState(false);

  const approvalIsValid = props.approval?.valid === true;
  const approvalExpired = props.approval !== null && !props.approval.valid;

  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-slate-900">Send a test email</h2>
      <p className="mt-1 text-sm text-slate-600">
        Test emails may only go to one authorised address. This cannot be changed here.
      </p>

      <dl className="mt-4 space-y-3">
        <AddressRow label="From" value={props.fromEmail} />
        <AddressRow label="To" value={props.toEmail} />
      </dl>

      <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700">
        <span aria-hidden>🔒</span> Authorised test recipient only
      </p>

      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Subject that will be sent
        </div>
        <div className="mt-1 break-words text-sm text-slate-800">{props.subject}</div>
      </div>

      {/* ---------------- provider status ---------------- */}
      {!props.providerConfigured ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Gmail test email provider is not configured
          </p>
          {props.providerProblems.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-amber-900">
              {props.providerProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-amber-900">
            You can still approve, but sending stays disabled until this is set up.
          </p>
        </div>
      ) : null}

      {/* ---------------- step 1: approve ---------------- */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">Step 1 — Approve</h3>

        {approvalIsValid && props.approval ? (
          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-900">Approved for one test send</p>
            <p className="mt-1 text-xs text-emerald-800">
              {new Date(props.approval.approvedAt).toLocaleString("en-GB")}
              {props.approval.approvedByEmail ? ` · ${props.approval.approvedByEmail}` : ""}
            </p>
            <form action={revokeTestApprovalAction} className="mt-2">
              <input type="hidden" name="campaignId" value={props.campaignId} />
              <button
                type="submit"
                className="text-xs font-semibold text-emerald-900 underline hover:text-emerald-700"
              >
                Withdraw approval
              </button>
            </form>
          </div>
        ) : (
          <>
            {approvalExpired ? (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">
                  {props.approval?.reason === "ALREADY_USED"
                    ? "That approval has already been used."
                    : "Approval expired because the newsletter changed."}
                </p>
                <p className="mt-1 text-xs text-amber-900">
                  Review the email above and approve again.
                </p>
              </div>
            ) : null}

            <form action={approveTestSendAction} className="mt-3">
              <input type="hidden" name="campaignId" value={props.campaignId} />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
                />
                <span className="text-xs leading-relaxed text-slate-700">
                  I approve sending this exact newsletter as one TEST email from{" "}
                  <strong className="font-mono">{props.fromEmail}</strong> to{" "}
                  <strong className="font-mono">{props.toEmail}</strong>.
                </span>
              </label>

              <button
                type="submit"
                disabled={!props.canApprove || !confirmed}
                className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                Approve Test Email
              </button>
            </form>
          </>
        )}
      </div>

      {/* ---------------- step 2: send ---------------- */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">Step 2 — Send</h3>

        <form action={sendTestEmailAction} className="mt-2">
          <input type="hidden" name="campaignId" value={props.campaignId} />
          <button
            type="submit"
            disabled={!props.canSend}
            title={props.canSend ? undefined : props.message}
            className="w-full rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            Send Test Email
          </button>
        </form>

        <p className="mt-2 text-xs text-slate-600">{props.message}</p>
        <p className="mt-1 text-xs text-slate-500">
          One approval allows exactly one email. Sending again needs a new approval.
        </p>
      </div>

      {/* ---------------- last attempt ---------------- */}
      {props.lastAttempt ? (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-bold text-slate-900">Last attempt</h3>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-semibold">{props.lastAttempt.state}</span>
            {props.lastAttempt.acceptedAt
              ? ` · ${new Date(props.lastAttempt.acceptedAt).toLocaleString("en-GB")}`
              : ""}
          </p>
          {props.lastAttempt.message ? (
            <p className="mt-1 text-xs text-slate-600">{props.lastAttempt.message}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
