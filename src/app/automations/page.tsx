import Link from "next/link";

import { Capability, requirePageCapability } from "../../server/auth/session";
import { listAutomations } from "../../server/services/automationService";
import { listSources } from "../../server/services/contentSourceService";
import { Badge, Card, PageHeader, buttonSecondary, inputClass } from "../../ui/primitives";
import {
  createAutomationAction,
  runAutomationAction,
  setAutomationEnabledAction,
} from "./actions";

/**
 * Newsletter automations.
 *
 * An automation collects from approved sources on a schedule and prepares a DRAFT.
 * The page says that plainly and repeatedly, because the difference between "prepares
 * a draft" and "sends a newsletter" is the difference somebody has to trust before
 * they will switch this on.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Automations — AXIS" };

const RUN_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PREPARED: { label: "Draft created", tone: "success" },
  PARTIAL: { label: "Draft created, some sources failed", tone: "warning" },
  NO_CONTENT: { label: "Nothing new to use", tone: "neutral" },
  FAILED: { label: "Did not work", tone: "danger" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  PENDING: { label: "Waiting", tone: "neutral" },
  PREPARING: { label: "Running", tone: "neutral" },
};

const LANGUAGE_LABEL: Record<string, string> = {
  HE: "Hebrew",
  AR: "Arabic",
  UNKNOWN: "Not set",
};

function when(value: Date | null | undefined): string {
  return value ? new Date(value).toLocaleString("en-GB") : "—";
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    ran?: string;
    status?: string;
    message?: string;
    error?: string;
  }>;
}) {
  await requirePageCapability(Capability.MANAGE_NEWSLETTERS, "/automations");
  const feedback = await searchParams;
  const [automations, sources] = await Promise.all([listAutomations(), listSources()]);
  const enabledSources = sources.filter((source) => source.isEnabled);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Have a newsletter draft prepared for you on a schedule, so you never start from a blank page."
        actions={
          <>
            <Link href="/content/inbox" className={buttonSecondary}>
              Review inbox
            </Link>
            <Link href="/newsletters" className={buttonSecondary}>
              Newsletters
            </Link>
          </>
        }
      />

      {feedback.ran ? (
        <div
          role="status"
          className={`rounded-lg border p-4 ${
            feedback.status === "FAILED"
              ? "border-rose-300 bg-rose-50"
              : feedback.status === "PARTIAL"
                ? "border-amber-300 bg-amber-50"
                : "border-emerald-300 bg-emerald-50"
          }`}
        >
          <p className="text-sm font-semibold text-slate-900">
            {feedback.message ?? "Finished."}
          </p>
        </div>
      ) : null}
      {feedback.created ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Automation created.</p>
        </div>
      ) : null}
      {feedback.updated ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Automation updated.</p>
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      {/* ---------------- what it does, and what it never does ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-sm font-bold text-emerald-900">What an automation does</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-emerald-900">
            <li>• Checks your approved sources on a schedule</li>
            <li>• Puts anything new into the review inbox</li>
            <li>• Builds a <strong>draft</strong> from articles you already approved</li>
          </ul>
        </Card>
        <Card className="border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-bold text-rose-900">What it never does</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-rose-900">
            <li>• Send an email — ever, to anyone</li>
            <li>• Approve an article on your behalf</li>
            <li>• Choose which customers would receive a newsletter</li>
          </ul>
        </Card>
      </div>

      {/* ---------------- existing automations ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">
          Your automations ({automations.length})
        </h2>

        {automations.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            None yet. Create one below to have a draft waiting for you every week or
            every month.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {automations.map((automation) => (
              <li key={automation.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{automation.name}</h3>
                      <Badge tone={automation.isEnabled ? "success" : "neutral"}>
                        {automation.isEnabled ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{automation.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {LANGUAGE_LABEL[automation.language] ?? automation.language} · up to{" "}
                      {automation.maxItems} articles ·{" "}
                      {automation.sources.length === 0
                        ? "all enabled sources"
                        : automation.sources.map((link) => link.source.name).join(", ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <form action={runAutomationAction}>
                      <input type="hidden" name="id" value={automation.id} />
                      <button
                        type="submit"
                        disabled={!automation.isEnabled}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        Run now
                      </button>
                    </form>
                    <form action={setAutomationEnabledAction}>
                      <input type="hidden" name="id" value={automation.id} />
                      <input
                        type="hidden"
                        name="enabled"
                        value={automation.isEnabled ? "no" : "yes"}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {automation.isEnabled ? "Pause" : "Resume"}
                      </button>
                    </form>
                  </div>
                </div>

                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">
                      Last run
                    </dt>
                    <dd className="mt-0.5 text-slate-700">{when(automation.lastRunAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">
                      Next run
                    </dt>
                    <dd className="mt-0.5 text-slate-700">
                      {automation.isEnabled
                        ? when(automation.nextScheduledAt)
                        : "Paused — will not run"}
                    </dd>
                  </div>
                </dl>

                {automation.runs.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Recent runs
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {automation.runs.map((run) => {
                        const status = RUN_STATUS[run.status] ?? {
                          label: run.status,
                          tone: "neutral" as const,
                        };
                        return (
                          <li
                            key={run.id}
                            className="flex flex-wrap items-center gap-2 text-xs text-slate-600"
                          >
                            <span className="tabular-nums">
                              {new Date(run.scheduledFor).toLocaleString("en-GB")}
                            </span>
                            <Badge tone={status.tone}>{status.label}</Badge>
                            <span>
                              {run.itemsFound} found · {run.itemsNew} new ·{" "}
                              {run.itemsUsed} used
                            </span>
                            {run.sourcesFailed > 0 ? (
                              <span className="text-amber-700">
                                {run.sourcesFailed} source
                                {run.sourcesFailed === 1 ? "" : "s"} failed
                              </span>
                            ) : null}
                            {run.generatedCampaign ? (
                              <Link
                                href={`/newsletters/${run.generatedCampaign.id}`}
                                className="font-semibold text-sky-700 underline hover:text-sky-900"
                              >
                                Open draft
                              </Link>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- create ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Create an automation</h2>

        {enabledSources.length === 0 ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            There are no enabled content sources yet, so an automation would have
            nothing to collect. Add one under{" "}
            <Link href="/sources" className="font-semibold underline">
              Sources
            </Link>{" "}
            first.
          </p>
        ) : null}

        <form action={createAutomationAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-semibold text-slate-800">Name</span>
            <input
              name="name"
              required
              className={inputClass}
              placeholder="Weekly AXIS technology digest"
            />
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">How often</span>
            <select name="cadence" className={inputClass} defaultValue="WEEKLY">
              <option value="WEEKLY">Every week</option>
              <option value="MONTHLY">Every month</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">Day of the week</span>
            <select name="dayOfWeek" className={inputClass} defaultValue="1">
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Used for weekly automations.
            </span>
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">Day of the month</span>
            <select name="dayOfMonth" className={inputClass} defaultValue="1">
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Used for monthly automations. Capped at 28 so no month is ever skipped.
            </span>
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">Time of day</span>
            <select name="hour" className={inputClass} defaultValue="8">
              {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">Newsletter language</span>
            <select name="language" className={inputClass} defaultValue="HE">
              <option value="HE">Hebrew</option>
              <option value="AR">Arabic</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">Most articles per draft</span>
            <input
              type="number"
              name="maxItems"
              min={1}
              max={20}
              defaultValue={5}
              className={inputClass}
            />
          </label>

          <label className="text-sm">
            <span className="font-semibold text-slate-800">
              Only this label <span className="font-normal text-slate-500">(optional)</span>
            </span>
            <input name="category" className={inputClass} placeholder="hardware" />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-semibold text-slate-800">
              Sources to collect from
            </legend>
            <p className="mt-0.5 text-xs text-slate-500">
              Tick none to use every enabled source.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {enabledSources.map((source) => (
                <label
                  key={source.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="sourceIds"
                    value={source.id}
                    className="h-4 w-4 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
                  />
                  <span className="text-slate-800">{source.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Create automation
            </button>
            <p className="mt-2 text-xs text-slate-500">
              This prepares drafts only. You still choose the audience, approve, and send
              every newsletter yourself.
            </p>
          </div>
        </form>
      </Card>
    </div>
  );
}
