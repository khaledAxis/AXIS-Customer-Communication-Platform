import { renderRichText } from "../domain/content/richText";
import { normalizeArticleSource } from "../domain/content/articleFormat";
import type { TextDirection } from "../domain/content/inlineDirection";

export function ArticleBodyPreview({ source, dir, baseUrl, label = "Article preview" }: {
  source: string; dir: TextDirection; baseUrl?: string | null; label?: string;
}) {
  const normalized = normalizeArticleSource(source, baseUrl);
  return <div role="region" aria-label={label} dir={dir} className="axis-richtext min-w-0 break-words text-start"
    // The shared parser escapes all text and generates every tag; only inline isolation differs for browsers.
    dangerouslySetInnerHTML={{ __html: renderRichText(normalized.source, dir, "browser") }} />;
}
