import Link from "next/link";
import type { ReactNode } from "react";

import type { Tone } from "./labels";
import { Icon } from "./Icon";

/**
 * Small presentational building blocks shared by every page.
 *
 * Layout uses Tailwind *logical* utilities (ms-/me-/ps-/pe-/text-start) so any
 * subtree switched to dir="rtl" mirrors correctly.
 */

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`axis-badge ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`axis-card ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export const buttonPrimary = "axis-button axis-button-primary";

export const buttonSecondary = "axis-button axis-button-secondary";

export const buttonDanger = "axis-button axis-button-danger";

export const buttonSubtle = "axis-button axis-button-subtle";

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  icon = "📄",
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <div aria-hidden className="empty-state-icon" data-illustration={icon}>
        <Icon name="article" size={28} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{description}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={`${buttonPrimary} mt-6`}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800">
        {label}
        {required ? <span className="ms-1 text-rose-600">*</span> : null}
      </label>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-2">{children}</div>
      {error ? <p className="mt-1.5 text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  );
}

export const inputClass = "axis-input";

export function ErrorSummary({ errors }: { errors: { field: string; message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm font-semibold text-rose-800">Please check the following:</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-rose-700">
        {errors.map((error) => (
          <li key={`${error.field}-${error.message}`}>{error.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Customer delivery stays locked; provider setup alone is not activation. */
export function TestModeBanner({ customerDeliveryConfigured = false }: { customerDeliveryConfigured?: boolean }) {
  return (
    <div className="mode-banner">
      <span className="mode-badge">{customerDeliveryConfigured ? "CUSTOMER DELIVERY CONFIGURED" : "TEST MODE"}</span>
      <span>{customerDeliveryConfigured ? "Approved and explicitly confirmed newsletters can reach customers. Review each delivery before scheduling." : "Customer delivery is locked. Safe tests go only to the authorised address."}</span>
      <Link href="/help">About test mode</Link>
    </div>
  );
}
