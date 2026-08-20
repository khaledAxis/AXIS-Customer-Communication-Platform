"use client";

import { useState } from "react";

import {
  approvePilotAction,
  revokePilotApprovalAction,
  sendPilotAction,
} from "../app/newsletters/[id]/pilotActions";
import { Card } from "./primitives";

/**
 * The internal PROVIDER PILOT panel (ADR-0025).
 *
 * Deliberately shaped like the SAFE TEST panel, because that shape works: the
 * addresses are read-only text, there is NO input with which to name a recipient, and
 * the two steps are two separate human actions.
 *
 * What it says out loud, every time: this goes through the real production transport,
 * to one internal address, and it is not customer sending.
 */

export interface ProviderPilotPanelProps {
  campaignId: string;
  providerName: string;
  providerConfigured: boolean;
  providerProblems: string[];
  pilotModeEnabled: boolean;
  domainVerified: boolean;
  domain: string;
  fromEmail: string;
  senderName: string;
  replyToEmail: string;
  toEmail: string;
  subject: string;
  canApprove: boolean;
  canSend: boolean;
  message: string;
  blockers: string[];
  approval: {
    approvedAt: string;
    approvedByEmail: string | null;
    valid: boolean;
    reason?: string;
  } | null;
  lastAttempt: {
    state: string;
    acceptedAt: string | null;
    providerMessageId: string | null;
    message: string | null;
  } | null;
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
        {value}
      </dd>
    </div>
  );
}

export function ProviderPilotPanel(props: ProviderPilotPanelProps) {
  const [confirmed, setConfirmed] = useState(false);

  const approvalIsValid = props.approval?.valid === true;
  const approvalExpired = props.approval !== null && !props.approval.valid;

  return (
    <Card className="border-indigo-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Internal provider pilot
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            One email through the real production provider ({props.providerName}), sent
            as the AXIS domain — to one internal address only.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-800">
          Internal
        </span>
      </div>

      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
        This is <strong>not</strong> customer sending. No audience is resolved, no
        customer address is read, and nothing is written to the delivery ledger.
        Enabling the pilot does not enable customer delivery — that is a separate
        switch, and it stays locked.
      </p>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            From
          </dt>
          <dd className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <span className="font-semibold">{props.senderName}</span>
            <br />
            <span className="font-mono text-xs">{props.fromEmail}</span>
          </dd>
        </div>
        <AddressRow label="Replies go to" value={props.replyToEmail} />
        <AddressRow label="To" value={props.toEmail} />
      </dl>

      <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-indigo-700">
        <span aria-hidden>🔒</span> Authorised pilot recipient only — this cannot be
        changed here or anywhere else
      </p>

      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Subject that will be sent
        </div>
        <div className="mt-1 break-words text-sm text-slate-800">{props.subject}</div>
      </div>

      {/* ---------------- blockers ---------------- */}
      {props.blockers.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            The pilot cannot run yet
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-amber-900">
            {props.blockers.includes("PROVIDER_NOT_CONFIGURED") ? (
              <li>
                {props.providerName} is not configured. The API key belongs in{" "}
                <code className="font-mono">.env.local</code> — never in a committed
                file, and never pasted into a chat.
              </li>
            ) : null}
            {props.blockers.includes("PILOT_MODE_OFF") ? (
              <li>
                The pilot switch is off. Set{" "}
                <code className="font-mono">PROVIDER_PILOT_ENABLED=true</code> in{" "}
                <code className="font-mono">.env.local</code> and restart the server.
                No page can flip it.
              </li>
            ) : null}
            {props.blockers.includes("DOMAIN_NOT_VERIFIED") ? (
              <li>
                <span className="font-mono">{props.domain}</span> is not verified with
                the provider. A pilot from an unauthenticated domain proves nothing —
                see Email infrastructure for the DNS records to publish.
              </li>
            ) : null}
            {props.blockers.includes("NO_CONTENT") ? (
              <li>This newsletter has no articles yet.</li>
            ) : null}
          </ul>
          {props.providerProblems.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-amber-900">
              {props.providerProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- step 1: approve ---------------- */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">Step 1 — Approve</h3>

        {approvalIsValid && props.approval ? (
          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-900">
              Approved for one provider pilot
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              {new Date(props.approval.approvedAt).toLocaleString("en-GB")}
              {props.approval.approvedByEmail
                ? ` · ${props.approval.approvedByEmail}`
                : ""}
            </p>
            <form action={revokePilotApprovalAction} className="mt-2">
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

            <form action={approvePilotAction} className="mt-3">
              <input type="hidden" name="campaignId" value={props.campaignId} />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-indigo-700 focus:ring-indigo-600"
                />
                <span className="text-xs leading-relaxed text-slate-700">
                  I approve sending this exact newsletter as{" "}
                  <strong>one internal pilot email</strong> through{" "}
                  {props.providerName}, from{" "}
                  <strong className="font-mono">{props.fromEmail}</strong> to{" "}
                  <strong className="font-mono">{props.toEmail}</strong>, with replies
                  going to <strong className="font-mono">{props.replyToEmail}</strong>.
                  No customer receives anything.
                </span>
              </label>

              <button
                type="submit"
                disabled={!props.canApprove || !confirmed}
                className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                Approve Provider Pilot
              </button>
            </form>
          </>
        )}
      </div>

      {/* ---------------- step 2: send ---------------- */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">Step 2 — Send</h3>
        <p className="mt-1 text-xs text-slate-600">
          Recipient count: <strong>1</strong> —{" "}
          <span className="font-mono">{props.toEmail}</span>.
        </p>

        <form action={sendPilotAction} className="mt-2">
          <input type="hidden" name="campaignId" value={props.campaignId} />
          <button
            type="submit"
            disabled={!props.canSend}
            title={props.canSend ? undefined : props.message}
            className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            Send Provider Pilot
          </button>
        </form>

        <p className="mt-2 text-xs text-slate-600">{props.message}</p>

        {props.lastAttempt ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Last pilot attempt</p>
            <p className="mt-1">
              {props.lastAttempt.state === "ACCEPTED"
                ? // Accepted, never "delivered": only the provider's delivery event
                  // proves the second, and it arrives later.
                  `${props.providerName} accepted it for delivery`
                : props.lastAttempt.state === "UNCERTAIN"
                  ? "Could not be confirmed — check the provider dashboard before trying again"
                  : props.lastAttempt.state}
              {props.lastAttempt.acceptedAt
                ? ` · ${new Date(props.lastAttempt.acceptedAt).toLocaleString("en-GB")}`
                : ""}
            </p>
            {props.lastAttempt.providerMessageId ? (
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                {props.lastAttempt.providerMessageId}
              </p>
            ) : null}
            {props.lastAttempt.message ? (
              <p className="mt-1">{props.lastAttempt.message}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
