"use client";
import { useActionState } from "react";
import { operationAction } from "../app/operations/actions";
import { buttonSecondary, inputClass } from "./primitives";
export function CrmScheduleControl({ enabled, interval }: { enabled: boolean; interval: number }) {
  const [state, action, pending] = useActionState(operationAction, { ok: false, message: "" });
  return <form action={action} className="mt-5 grid gap-4"><input type="hidden" name="operation" value="schedule"/>
    <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4 accent-sky-700"/>Enable scheduled CRM reconciliation and signed webhook processing</label>
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-xs font-semibold text-slate-600">Sync interval (minutes)<input name="interval" type="number" min={15} max={1440} defaultValue={interval} required className={inputClass}/></label><button className={buttonSecondary} disabled={pending}>{pending ? "Saving…" : "Save schedule"}</button></div>
    <p className="text-xs text-slate-500">Background work uses your recorded authorization. Deactivating your account stops it. Monday remains the source of truth.</p>
    {state.message && <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>}</form>;
}
export function RetryCrmControl({ id }: { id: string }) {
  const [state, action, pending] = useActionState(operationAction, { ok: false, message: "" });
  return <form action={action}><input type="hidden" name="operation" value="retry"/><input type="hidden" name="jobId" value={id}/><button className={buttonSecondary} disabled={pending}>Retry sync</button>{state.message && <p role="status" className="mt-1 text-xs">{state.message}</p>}</form>;
}
