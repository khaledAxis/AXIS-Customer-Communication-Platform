import Link from "next/link";
import type { TranslationSourceOverview } from "../domain/content/hebrewTranslation";
import { buttonSecondary } from "./primitives";
import { BidiText } from "./BidiText";
import { articleDirection } from "../domain/content/inlineDirection";

export function TranslationSourceDetails({ id, source }: { id: string; source: TranslationSourceOverview }) {
  const missingBody = source.bodyWordCount === 0;
  const dir = articleDirection(null, source.title + source.excerpt + source.bodyText);
  return <div className="space-y-3">
    <div className={`rounded-lg border p-4 ${missingBody || source.bodyAppearsCutOff ? "border-amber-200 bg-amber-50 text-amber-950" : "border-sky-200 bg-white text-slate-800"}`}>
      <p className="text-sm font-bold">{missingBody ? `Article text missing — only the ${source.excerpt ? "title and excerpt are" : "title is"} available` : source.bodyAppearsCutOff ? "The saved article text appears cut off" : `Saved article text included · ${source.bodyWordCount} words`}</p>
      <p className="mt-2 text-sm leading-relaxed">{missingBody
        ? "A feed may supply only a short introduction. The source link does not include the full article in your translation prompt."
        : "Check the saved text below for completeness. AXIS translates what is saved here; it does not open the source link."}</p>
      {source.excerptAppearsCutOff && <p className="mt-2 text-sm">The excerpt ends with an ellipsis (…) and may be incomplete.</p>}
      <p className="mt-2 text-sm leading-relaxed">For a full translation, paste or import the complete article into Article text, save your changes, then prepare a fresh prompt.</p>
      <Link href={`/content/${id}/edit#article-text`} className={`${buttonSecondary} mt-3`}>{missingBody ? "Add full article text" : "Edit saved article text"}</Link>
    </div>
    <details className="rounded-lg border border-sky-100 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-sky-900">Text included in this translation</summary>
      <dl className="mt-3 space-y-3 text-sm">
        <div><dt className="font-semibold text-slate-500">Title</dt><dd dir={dir} className="mt-1 text-slate-800"><BidiText text={source.title} dir={dir} /></dd></div>
        <div><dt className="font-semibold text-slate-500">Excerpt</dt><dd dir={dir} className="mt-1 text-slate-800"><BidiText text={source.excerpt || "No excerpt saved."} dir={dir} /></dd></div>
        <div><dt className="font-semibold text-slate-500">Article text</dt><dd dir={dir} className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-slate-800"><BidiText text={source.bodyText || "No article text saved."} dir={dir} /></dd></div>
      </dl>
    </details>
  </div>;
}
