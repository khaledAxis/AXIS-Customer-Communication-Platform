"use client";

import { useFormStatus } from "react-dom";

import { syncCrmAction } from "../app/customers/actions";
import { Card } from "./primitives";

/**
 * CRM synchronization panel.
 *
 * The button performs a READ-ONLY import from Monday. Nothing in this platform writes
 * back to Monday, and the panel says so plainly so nobody wonders.
 */

function SyncButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
    >
      {pending ? "Syncing from Monday…" : "Sync from Monday"}
    </button>
  );
}

export interface CrmSyncPanelProps {
  connected: boolean;
  statusMessage: string;
  lastSyncAt: string | null;
  counts: {
    companies: number;
    contacts: number;
    products: number;
    customerProducts: number;
    addresses: number;
  };
}

export function CrmSyncPanel(props: CrmSyncPanelProps) {
  const stats = [
    { label: "Companies", value: props.counts.companies },
    { label: "Contacts", value: props.counts.contacts },
    { label: "Products", value: props.counts.products },
    { label: "Customer products", value: props.counts.customerProducts },
    { label: "Email addresses", value: props.counts.addresses },
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">Customer information from Monday</h2>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                props.connected
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200"
              }`}
            >
              {props.statusMessage}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Last updated:{" "}
            <strong className="font-semibold text-slate-800">
              {props.lastSyncAt ? new Date(props.lastSyncAt).toLocaleString("en-GB") : "never"}
            </strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            This only reads from Monday. Nothing in this app changes your Monday boards.
          </p>
        </div>

        <form action={syncCrmAction}>
          <SyncButton disabled={!props.connected} />
          {!props.connected ? (
            <p className="mt-2 max-w-[14rem] text-xs text-amber-800">
              Connect Monday before importing customers.
            </p>
          ) : null}
        </form>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <dd className="text-xl font-bold tabular-nums text-slate-900">
              {stat.value.toLocaleString()}
            </dd>
            <dt className="mt-0.5 text-xs font-semibold text-slate-600">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </Card>
  );
}
