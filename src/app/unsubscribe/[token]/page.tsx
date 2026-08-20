import { headers } from "next/headers";

import { lookupUnsubscribeToken } from "../../../server/services/unsubscribeService";
import { UnsubscribePanel } from "../../../ui/UnsubscribePanel";
import { confirmUnsubscribeAction } from "./actions";

/**
 * The public unsubscribe page (ADR-0024).
 *
 * No AXIS account required — that is the point. It is listed as public in
 * `src/proxy.ts`, and it deliberately renders no application navigation.
 *
 * A GET RESOLVES the token and CHANGES NOTHING. Mail clients prefetch links, security
 * appliances open every URL in a message, and corporate proxies follow them on the
 * recipient's behalf; a GET that unsubscribed would quietly opt out people who never
 * clicked. The write lives behind the button.
 *
 * The page also shows the recipient nothing about themselves. Every failure — bad
 * token, revoked token, unknown token — renders the identical sentence, so it cannot
 * be used to find out which addresses AXIS holds.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Unsubscribe — AXIS",
  // A public page that must never be indexed or followed by a crawler.
  robots: { index: false, follow: false },
};

async function clientKey(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first && first !== "" ? first : (list.get("x-real-ip") ?? "unknown");
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] items-center py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-base font-black text-white"
          >
            AX
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-900">
              AXIS Advanced Mapping Solutions
            </p>
            <p className="text-xs text-slate-500">Newsletter preferences</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lookup = await lookupUnsubscribeToken(token, {
    clientKey: await clientKey(),
  });

  if (!lookup.ok) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-slate-900">
          {lookup.reason === "TEST_TOKEN" ? "Preview link" : "Link not recognised"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{lookup.message}</p>
        <p className="mt-4 text-xs text-slate-500">
          Need help? Contact us at{" "}
          <a
            href="mailto:info@axis-gps.com"
            className="font-semibold text-sky-700 hover:underline"
            dir="ltr"
          >
            info@axis-gps.com
          </a>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-slate-900">
        Unsubscribe from AXIS emails?
      </h1>
      <div className="mt-3">
        {/* The resolved address is deliberately NOT passed to the client: a forwarded
            link must not tell the new holder whose address it was. */}
        <UnsubscribePanel
          token={token}
          action={confirmUnsubscribeAction}
          alreadyUnsubscribed={lookup.alreadyUnsubscribed}
        />
      </div>
    </Shell>
  );
}
