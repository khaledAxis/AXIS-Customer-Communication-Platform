"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { translateArticleToHebrew } from "../app/content/translationActions";
import { buttonPrimary, buttonSecondary } from "./primitives";
import { ChatgptArticleTranslation } from "./ChatgptArticleTranslation";
import type { TranslationSourceOverview } from "../domain/content/hebrewTranslation";
import { TranslationSourceDetails } from "./TranslationSourceDetails";

export function ArticleTranslationPanel({ id, configured, message, latest, source }: {
  id: string; configured: boolean; message: string;
  source: TranslationSourceOverview;
  latest: { state: string; generatedContentItemId: string | null } | null;
}) {
  const [state, action, pending] = useActionState(translateArticleToHebrew, { message: "" });
  const [method, setMethod] = useState<"chatgpt" | "api">("chatgpt");
  const running = pending || latest?.state === "RUNNING";
  return <section aria-labelledby="hebrew-translation-title" className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">For your Hebrew-speaking readers</p>
        <h2 id="hebrew-translation-title" className="mt-1 text-lg font-bold text-slate-900">Prepare a Hebrew version <span lang="he" dir="rtl" className="ms-2 text-sky-800">גרסה בעברית</span></h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Translate the saved title, excerpt and article text into Hebrew. Technical terms, figures, links and pictures stay connected to the source. The result opens as a separate draft for your review.</p>
        <p className="mt-2 text-xs text-slate-500">Save any article changes before preparing a translation. The original article is kept.</p>
      </div>
      {latest?.generatedContentItemId && <Link href={`/content/${latest.generatedContentItemId}/edit`} className={buttonSecondary}>Review Hebrew version</Link>}
    </div>
    <div role="group" aria-label="Translation method" className="mt-4 flex flex-wrap gap-2">
      <button type="button" aria-pressed={method === "chatgpt"} onClick={() => setMethod("chatgpt")} className={method === "chatgpt" ? buttonPrimary : buttonSecondary}>Use ChatGPT · no API credits</button>
      <button type="button" aria-pressed={method === "api"} onClick={() => setMethod("api")} className={method === "api" ? buttonPrimary : buttonSecondary}>Automatic translation · API</button>
    </div>
    {method === "chatgpt" ? <ChatgptArticleTranslation id={id} source={source} /> : <div className="mt-4 space-y-4">
      <TranslationSourceDetails id={id} source={source} />
      <p className="mb-3 text-sm text-slate-600">Translate directly through OpenAI. This option needs API credits, billed separately from your ChatGPT subscription.</p>
      <form action={action} className="flex flex-col items-start gap-2">
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={!configured || running} className={buttonPrimary}>
          {running ? "Preparing Hebrew…" : !source.bodyWordCount ? source.excerpt ? "Translate title and excerpt only" : "Translate title only" : latest?.state === "FAILED" ? "Try Hebrew translation again" : "Create Hebrew draft"}
        </button>
      </form>
    {!configured && <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>}
    {running && <p role="status" className="mt-3 text-sm text-sky-800">Translating the saved passages. This may take up to a minute and a half. Nothing is approved or sent.</p>}
    {latest?.state === "FAILED" && !pending && <p className="mt-3 text-sm text-amber-900">The previous translation did not finish. You can start a new attempt.</p>}
    {state.message && <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{state.message}</p>}
    </div>}
  </section>;
}
