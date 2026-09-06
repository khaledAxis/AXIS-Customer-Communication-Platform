"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * Renders the REAL generated email HTML inside a sandboxed iframe.
 *
 * The `html` prop comes from `renderNewsletterHtml` — the same function a provider
 * adapter would send. There is no separate "preview design"; switching device width
 * only changes the viewport, never the markup.
 */

type Device = "desktop" | "mobile";

const WIDTHS: Record<Device, string> = {
  desktop: "max(100%, 680px)",
  mobile: "390px", // typical modern phone viewport
};

export function EmailPreview({ html }: { html: string }) {
  const [device, setDevice] = useState<Device>("desktop");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Preview size"
          className="inline-flex rounded-lg border border-slate-300 bg-white p-1"
        >
          {(
            [
              { value: "desktop", label: "Computer", icon: "monitor" },
              { value: "mobile", label: "Phone", icon: "phone" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDevice(option.value)}
              aria-pressed={device === option.value}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${
                device === option.value
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon name={option.icon} size={17} />
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-slate-500">
          The same layout your readers receive.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4" role="region" aria-label="Email preview canvas" tabIndex={0}>
        <div className="mx-auto" style={{ width: WIDTHS[device] }}>
        <iframe
          // Remounting on device change guarantees a clean re-layout.
          key={device}
          title="Newsletter preview"
          srcDoc={html}
          sandbox=""
          className="h-[70vh] min-h-[32rem] w-full rounded-lg border border-slate-300 bg-white shadow-sm"
        />
        </div>
      </div>
    </div>
  );
}
