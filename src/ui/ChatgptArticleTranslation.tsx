"use client";
import { useActionState, useRef, useState } from "react";
import { importChatgptArticle, prepareChatgptArticle } from "../app/content/translationActions";
import { buttonPrimary, buttonSecondary, inputClass } from "./primitives";
import type { TranslationSourceOverview } from "../domain/content/hebrewTranslation";
import { TranslationSourceDetails } from "./TranslationSourceDetails";

export function ChatgptArticleTranslation({ id, source }: { id: string; source: TranslationSourceOverview }) {
  const [prepared, prepare, preparing] = useActionState(prepareChatgptArticle, { message: "", prompt: "", receipt: "", source: null });
  const [imported, save, saving] = useActionState(importChatgptArticle, { message: "" });
  const [copyStatus, setCopyStatus] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [replyEdited, setReplyEdited] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const included = prepared.source ?? source;
  const copy = async () => {
    try { await navigator.clipboard.writeText(prepared.prompt); setCopyStatus("Copied. Paste it into ChatGPT and send it."); }
    catch { setShowPrompt(true); setCopyStatus("Select and copy the prompt below, then paste it into ChatGPT."); requestAnimationFrame(() => prompt.current?.select()); }
  };
  return <div className="mt-4 space-y-4">
    <p className="text-sm leading-relaxed text-slate-600">Use your regular ChatGPT account. Copy the prepared prompt, translate it in ChatGPT, then bring the reply back here. Your usual ChatGPT limits apply; this route makes no API calls.</p>
    <TranslationSourceDetails id={id} source={included} />
    {!prepared.prompt ? <form action={prepare}>
      <input type="hidden" name="id" value={id} />
      <button className={buttonPrimary} disabled={preparing}>{preparing ? "Preparing article…" : !included.bodyWordCount ? included.excerpt ? "Prepare title and excerpt only" : "Prepare title only" : "Prepare for ChatGPT"}</button>
    </form> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-sky-100 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">1. Copy your article prompt</p>
          <button type="button" onClick={copy} className={buttonPrimary}>Copy prompt</button>
          {copyStatus && <p role="status" className="mt-2 text-sm text-sky-800">{copyStatus}</p>}
        </div>
        <div className="rounded-lg border border-sky-100 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">2. Translate in ChatGPT</p>
          <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className={buttonSecondary}>Open ChatGPT ↗</a>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">Paste only the prepared prompt and send it. The saved passages are already inside it. Do not append a website link or ask for missing text. Copy the complete reply when it finishes.</p>
        </div>
      </div>
      <details open={showPrompt} onToggle={event => setShowPrompt(event.currentTarget.open)} className="rounded-lg border border-sky-100 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium text-sky-800">View or select the prepared prompt</summary>
        <textarea ref={prompt} aria-label="Translation prompt" readOnly value={prepared.prompt} rows={7} dir="ltr" className={`${inputClass} mt-3 text-xs`} />
      </details>
      <form key={prepared.receipt} action={save} onSubmit={() => setReplyEdited(false)} className="rounded-lg border border-sky-100 bg-white p-4">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="receipt" value={prepared.receipt} />
        <label htmlFor={`chatgpt-reply-${id}`} className="block text-sm font-semibold text-slate-900">3. Paste ChatGPT’s reply</label>
        <p className="my-2 text-xs leading-relaxed text-slate-500">Paste the complete reply as it is. AXIS checks it against this article and restores the formatting. You can edit the Hebrew in the next screen.</p>
        <textarea id={`chatgpt-reply-${id}`} name="reply" required maxLength={200000} rows={7} dir="auto" onChange={() => setReplyEdited(true)} placeholder="Paste the complete ChatGPT reply here" className={inputClass} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className={buttonPrimary} disabled={saving || preparing}>{saving ? "Checking and saving…" : "Save Hebrew draft"}</button>
          <span className="text-xs text-slate-500">Saved separately. Review before approval.</span>
        </div>
        {imported.message && !replyEdited && !saving && <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{imported.message}</p>}
      </form>
      <p className="text-xs text-slate-500">Complete this step within 24 hours using the same AXIS account. If you change the source article, prepare a fresh prompt.</p>
      <form action={prepare} onSubmit={() => { setCopyStatus(""); setReplyEdited(true); }}><input type="hidden" name="id" value={id} />
        <button className={buttonSecondary} disabled={preparing}>{preparing ? "Preparing…" : "Prepare a fresh prompt"}</button>
      </form>
    </>}
    {prepared.message && <p role="alert" className="text-sm font-semibold text-rose-800">{prepared.message}</p>}
  </div>;
}
