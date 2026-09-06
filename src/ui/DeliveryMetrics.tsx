import type { DeliveryMetrics as Metrics } from "../server/services/reportService";
import { Card } from "./primitives";

export function DeliveryMetrics({ metrics, unsubscribed }: { metrics: Metrics; unsubscribed: number }) {
  const figures = [
    ["Accepted", metrics.accepted, "Provider took responsibility"],
    ["Delivered", metrics.delivered, "Confirmed by provider events"],
    ["Unique opens", metrics.opened, "Recipients with an observed open"],
    ["Unique clicks", metrics.clicked, "Recipients with an observed click"],
  ] as const;
  return <>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{figures.map(([label, count, hint]) => <Card className="p-5" key={label}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-3 text-4xl font-semibold tabular-nums tracking-tight text-slate-900">{count.toLocaleString()}</p>
      <p className="mt-3 text-xs text-slate-500">{hint}</p>
    </Card>)}</div>
    <Card className="mt-4 flex flex-wrap gap-x-8 gap-y-3 px-5 py-4">{[
      ["Prepared", metrics.prepared], ["Attempted", metrics.attempted], ["Bounced", metrics.bounced],
      ["Spam complaints", metrics.complained], ["Unsubscribed", unsubscribed], ["Suppressed", metrics.suppressed],
      ["Failed", metrics.failed], ["Outcome unknown", metrics.uncertain],
    ].map(([label, count]) => <p className="text-sm text-slate-500" key={label}><strong className="me-2 tabular-nums text-slate-900">{count.toLocaleString()}</strong>{label}</p>)}</Card>
    <p className="my-4 max-w-4xl text-xs leading-relaxed text-slate-500">Opens and clicks are observed events, not proof that a person read the message. Privacy tools can hide or generate activity. Zero means no event recorded. Unsubscribes shown here have a known campaign attribution; other global opt-outs still block delivery.</p>
  </>;
}
