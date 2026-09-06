"use client";
import { useActionState, useState } from "react";
import { customerDeliveryAction } from "../app/newsletters/[id]/dispatchActions";
import { deliveryConfirmation } from "../domain/jobs/policy";
import { buttonPrimary, buttonSecondary, inputClass } from "./primitives";

export function CustomerDeliveryControls({ campaignId, count, status, enabled, blockers }: {
  campaignId: string; count: number; status: string; enabled: boolean; blockers: string[];
}) {
  const [state, action, pending] = useActionState(customerDeliveryAction, { ok: false, message: "" });
  const [date, setDate] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const phrase = deliveryConfirmation(count);
  const operation = status === "SENDING" ? "resume" : status === "SCHEDULED" ? "reschedule" : "schedule";
  const terminal = ["SENT", "FAILED", "CANCELED"].includes(status);
  return <div>
    {blockers.length > 0 && <ul className="my-3 list-disc space-y-1 ps-5 text-sm text-slate-600">{blockers.map(text => <li key={text}>{text}</li>)}</ul>}
    {terminal ? <p className="mt-3 text-sm text-slate-600">This delivery is closed. Open its report for confirmed outcomes.</p> :
      <form action={action} className="mt-5 grid gap-4 sm:max-w-xl">
        <input type="hidden" name="campaignId" value={campaignId}/>
        <input type="hidden" name="scheduledAt" value={date && Number.isFinite(new Date(date).getTime()) ? new Date(date).toISOString() : ""}/>
        {operation !== "resume" && <label className="grid gap-2 text-sm font-semibold">Delivery time (your local time)
          <input className={inputClass} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} disabled={!enabled || pending}/>
        </label>}
        <label className="grid gap-2 text-sm font-semibold">Type <span className="font-mono">{phrase}</span> to authorize {count.toLocaleString()} customer destinations
          <input className={inputClass} name="confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" disabled={!enabled || pending}/>
        </label>
        <p className="text-xs text-slate-600">This authorizes real customer email. Eligibility is checked again before submission. Continuing an interrupted delivery includes only destinations with no prior attempt.</p>
        <div className="flex flex-wrap gap-3">
          <button className={buttonPrimary} name="operation" value={operation} disabled={!enabled || pending || confirmation !== phrase || (operation !== "resume" && !date)}>
            {pending ? "Recording…" : operation === "resume" ? "Continue unattempted destinations" : operation === "reschedule" ? "Reschedule after review" : "Schedule customer delivery"}
          </button>
          {status === "SCHEDULED" && <button name="operation" value="cancel" className={buttonSecondary} disabled={pending}>Cancel scheduled delivery</button>}
        </div>
      </form>}
    {state.message && <p role="status" className={`mt-4 text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>}
  </div>;
}
