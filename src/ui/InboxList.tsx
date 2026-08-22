"use client";

import Link from "next/link";
import { useState } from "react";

import {
  approveContentAction,
  createDraftAction,
  rejectContentAction,
} from "../app/content/inbox/actions";
import { Badge, Card } from "./primitives";

/**
 * The review-inbox list.
 *
 * Interactive for exactly one reason: building a newsletter needs an ORDERED
 * selection, and the order is what the person clicked. The first article they tick
 * becomes the featured one, and the panel says so rather than leaving them to guess.
 *
 * Approving and rejecting are plain form posts — a decision about a single article
 * should not depend on client state.
 */

export interface InboxItem {
  id: string;
  title: string;
  axisHeadline: string | null;
  summary: string | null;
  sourceName: string | null;
  externalUrl: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  reviewState: string;
  usedInNewsletters: number;
}

const STATE_LABEL: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Not used", tone: "neutral" },
  PENDING_REVIEW: { label: "Waiting for review", tone: "warning" },
  NEW: { label: "Waiting for review", tone: "warning" },
};

function published(value: string | null): string {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function InboxList({
  items,
  filter,
}: {
  items: InboxItem[];
  filter: string;
}) {
  // Ordered: the sequence of clicks IS the newsletter order.
  const [selected, setSelected] = useState<string[]>([]);

  const approvedItems = items.filter((item) => item.reviewState === "APPROVED");
  const canBuild = filter === "APPROVED" || approvedItems.length > 0;

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <div className="space-y-4">
      {selected.length > 0 ? (
        <Card className="sticky top-4 z-10 border-sky-300 bg-sky-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-sky-900">
                {selected.length} article{selected.length === 1 ? "" : "s"} chosen
              </p>
              <p className="mt-0.5 text-xs text-sky-800">
                The first one you ticked becomes the main article at the top. This
                creates a draft only — nothing is sent, and no recipients are chosen.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
              >
                Clear
              </button>
              <form action={createDraftAction}>
                {selected.map((id) => (
                  <input key={id} type="hidden" name="selected" value={id} />
                ))}
                <button
                  type="submit"
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
                >
                  Create newsletter draft
                </button>
              </form>
            </div>
          </div>
        </Card>
      ) : canBuild ? (
        <p className="text-xs text-slate-500">
          Tick approved articles to build a newsletter draft from them.
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => {
          const state = STATE_LABEL[item.reviewState] ?? {
            label: item.reviewState,
            tone: "neutral" as const,
          };
          const isApproved = item.reviewState === "APPROVED";
          const position = selected.indexOf(item.id);

          return (
            <li key={item.id}>
              <Card
                className={`p-4 ${position === 0 ? "border-sky-400" : ""}`}
              >
                <div className="flex gap-4">
                  {isApproved ? (
                    <label className="flex shrink-0 cursor-pointer items-start pt-1">
                      <input
                        type="checkbox"
                        checked={position >= 0}
                        onChange={() => toggle(item.id)}
                        aria-label={`Include ${item.title}`}
                        className="h-4 w-4 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
                      />
                    </label>
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden />
                  )}

                  {item.imageUrl ? (
                    <>
                      {/* A plain <img>, not next/image: this is an external thumbnail of
                          unknown dimensions on a host AXIS has not approved for
                          optimisation, shown for review only. Routing it through the
                          image optimiser would make this server fetch it — the exact
                          thing the source rules exist to control. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="hidden h-20 w-28 shrink-0 rounded-md object-cover sm:block"
                      />
                    </>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={state.tone}>{state.label}</Badge>
                      {position === 0 ? (
                        <span className="rounded-full bg-sky-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                          Main article
                        </span>
                      ) : position > 0 ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                          #{position + 1}
                        </span>
                      ) : null}
                      {item.usedInNewsletters > 0 ? (
                        <span className="text-[11px] font-semibold text-slate-500">
                          Already in {item.usedInNewsletters} newsletter
                          {item.usedInNewsletters === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-1.5 text-sm font-bold text-slate-900">
                      {item.axisHeadline ?? item.title}
                    </h3>
                    {item.axisHeadline ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Original title: {item.title}
                      </p>
                    ) : null}

                    <p className="mt-1 text-xs text-slate-600">
                      {item.sourceName ?? "Unknown source"} · {published(item.publishedAt)}
                    </p>

                    {item.summary ? (
                      <p className="mt-2 line-clamp-3 text-sm text-slate-700">
                        {item.summary}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/content/inbox/${item.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Review
                      </Link>

                      {item.externalUrl ? (
                        <a
                          href={item.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Open original ↗
                        </a>
                      ) : null}

                      {!isApproved ? (
                        <form action={approveContentAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800"
                          >
                            Approve
                          </button>
                        </form>
                      ) : null}

                      {item.reviewState !== "REJECTED" ? (
                        <form action={rejectContentAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            Not for us
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
