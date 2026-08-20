"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import type { ReadinessFormState } from "../app/newsletters/[id]/readinessActions";
import { buttonPrimary, buttonSecondary, buttonSubtle } from "./primitives";

/**
 * The three preparation actions on the readiness screen.
 *
 * None of them sends anything. "Prepare final audience" freezes who would receive the
 * newsletter; "Approve" records that a person accepted that exact newsletter to that
 * exact frozen audience. Production sending is a separate control that does not
 * exist yet, and the wording here says so rather than implying a next step.
 *
 * Approving asks twice, naming the recipient count, because it is the action a person
 * would later point at to say "this was authorised".
 */

type Action = (
  state: ReadinessFormState,
  formData: FormData,
) => Promise<ReadinessFormState>;

function Result({ state }: { state: ReadinessFormState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`mt-2 rounded-lg border p-3 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900"
      }`}
    >
      {state.message}
    </p>
  );
}

export function PrepareAudienceButton({
  campaignId,
  action,
  hasExisting,
  disabled,
}: {
  campaignId: string;
  action: Action;
  hasExisting: boolean;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });

  /**
   * One token per intent (ADR-0023 §concurrency).
   *
   * Generated when the button mounts and resent unchanged on a double click or a
   * browser retry, so those collapse into ONE frozen snapshot. It is refreshed after
   * a successful preparation, so a later deliberate press is a genuinely new
   * preparation and is allowed to create a new snapshot.
   */
  const [token, setToken] = useState(() => crypto.randomUUID());
  const lastMessage = useRef<string>("");
  useEffect(() => {
    if (state.ok && state.message !== "" && state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      setToken(crypto.randomUUID());
    }
  }, [state.ok, state.message]);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="preparationKey" value={token} />
        <button
          type="submit"
          className={hasExisting ? buttonSecondary : buttonPrimary}
          disabled={pending || disabled}
        >
          {pending
            ? "Resolving…"
            : hasExisting
              ? "Prepare final audience again"
              : "Prepare final audience"}
        </button>
        <span className="text-xs text-slate-600">
          Freezes exactly who would receive this. Creates no delivery record and sends
          nothing.
        </span>
      </form>
      <Result state={state} />
    </div>
  );
}

export function ApproveProductionButtons({
  campaignId,
  approveAction,
  revokeAction,
  eligibleCount,
  hasValidApproval,
  disabled,
  blockedReason,
}: {
  campaignId: string;
  approveAction: Action;
  revokeAction: Action;
  eligibleCount: number;
  hasValidApproval: boolean;
  disabled: boolean;
  blockedReason: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [approveState, approveFormAction, approvePending] = useActionState(
    approveAction,
    { ok: false, message: "" },
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState(revokeAction, {
    ok: false,
    message: "",
  });

  return (
    <div className="space-y-3">
      {hasValidApproval ? (
        <form action={revokeFormAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className={buttonSecondary} disabled={revokePending}>
            {revokePending ? "Withdrawing…" : "Withdraw approval"}
          </button>
          <span className="text-xs text-slate-600">
            Use this if anything about the newsletter or its audience needs to change.
          </span>
        </form>
      ) : (
        <form action={approveFormAction}>
          <input type="hidden" name="campaignId" value={campaignId} />

          {/* Distinct keys: without them React reuses one DOM node and flips its
              `type` from button to submit mid-click, skipping the confirmation. */}
          {confirming ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                You are approving this exact newsletter for{" "}
                {eligibleCount.toLocaleString()} email address
                {eligibleCount === 1 ? "" : "es"}.
              </p>
              <p className="mt-1 text-xs text-amber-900">
                This records the approval only. No email is sent, no delivery record is
                created, and production sending stays locked. If the newsletter or the
                audience changes afterwards, this approval stops being valid.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  key="confirm-production-approval"
                  type="submit"
                  className={buttonPrimary}
                  disabled={approvePending}
                >
                  {approvePending ? "Recording…" : "Yes, approve this"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={buttonSubtle}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                key="request-production-approval"
                type="button"
                onClick={() => setConfirming(true)}
                className={buttonPrimary}
                disabled={disabled}
              >
                Approve this newsletter and audience
              </button>
              <span className="text-xs text-slate-600">
                {disabled
                  ? (blockedReason ??
                    "Finish the steps above before approving.")
                  : "Records approval of this exact content and these exact recipients."}
              </span>
            </div>
          )}
        </form>
      )}

      <Result state={approveState} />
      <Result state={revokeState} />
    </div>
  );
}

/**
 * Prepares the production delivery ledger.
 *
 * Labelled unambiguously, because "prepare delivery records" is the closest thing on
 * this screen to an action that could be mistaken for sending. It creates rows and
 * makes no network call; the production provider that would transmit them refuses to
 * send at all.
 */
export function PrepareLedgerButton({
  campaignId,
  action,
  eligibleCount,
  disabled,
  blockedReason,
}: {
  campaignId: string;
  action: Action;
  eligibleCount: number;
  disabled: boolean;
  blockedReason: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="campaignId" value={campaignId} />

        {confirming ? (
          <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">
              Prepare {eligibleCount.toLocaleString()} delivery record
              {eligibleCount === 1 ? "" : "s"} — NO EMAIL WILL BE SENT.
            </p>
            <p className="mt-1 text-xs text-slate-700">
              This writes the ledger the future send would work from and re-checks
              unsubscribe, blocked and address status right now. Anyone who opted out
              since approval is recorded as suppressed and can never be submitted.
              Production sending stays locked either way.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Distinct keys: without them React reuses one DOM node and flips its
                  `type` from button to submit mid-click, skipping the confirmation. */}
              <button
                key="confirm-prepare-ledger"
                type="submit"
                className={buttonSecondary}
                disabled={pending}
              >
                {pending ? "Preparing…" : "Yes, prepare the records"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={buttonSubtle}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              key="request-prepare-ledger"
              type="button"
              onClick={() => setConfirming(true)}
              className={buttonSecondary}
              disabled={disabled}
            >
              Prepare delivery records — NO EMAIL WILL BE SENT
            </button>
            <span className="text-xs text-slate-600">
              {disabled
                ? (blockedReason ?? "Approve this newsletter first.")
                : "Creates the delivery ledger. Makes no network call."}
            </span>
          </div>
        )}
      </form>
      <Result state={state} />
    </div>
  );
}
