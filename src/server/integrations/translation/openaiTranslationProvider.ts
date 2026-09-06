import "server-only";
import { HEBREW_TRANSLATION_INSTRUCTIONS, type TranslationSegment } from "../../../domain/content/hebrewTranslation";
import { TranslationProviderError, type TranslationProvider } from "./translationProvider";

const MAX_RESPONSE_BYTES = 512_000;
export const DEFAULT_TRANSLATION_MODEL = "gpt-5.4-mini-2026-03-17";
const schema = { type: "object", additionalProperties: false, required: ["segments"], properties: {
  segments: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } } },
} };
const failure = () => new TranslationProviderError("INVALID_RESPONSE", "OpenAI did not return a complete translation. No draft was saved.");

/** The request contract is inspectable without constructing a live adapter. */
export function translationRequest(model: string, segments: TranslationSegment[]) {
  return { model, store: false, tools: [], instructions: HEBREW_TRANSLATION_INSTRUCTIONS,
    input: [{ role: "user", content: JSON.stringify({ segments }) }],
    max_output_tokens: 12_000, reasoning: { effort: "none" },
    text: { format: { type: "json_schema", name: "hebrew_article_translation", strict: true, schema } },
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw failure(); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw failure(); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw failure(); }
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object"; }

/** Only known error codes leave the boundary; never return provider messages or keys. */
export function translationHttpError(status: number, value: unknown): TranslationProviderError {
  const error = isObject(value) && isObject(value.error) ? value.error : null;
  if (status === 429 && error?.code === "credit_balance_exhausted")
    return new TranslationProviderError("API_CREDITS", "OpenAI API credits are exhausted. Ask your administrator to add API credits in OpenAI billing before trying again.");
  if (status === 429 && ["organization_spend_limit_exceeded", "project_spend_limit_exceeded"].includes(String(error?.code)))
    return new TranslationProviderError("API_SPEND_LIMIT", "This OpenAI account or project has reached its API spending limit. Ask your administrator to review that limit before trying again.");
  if (status === 429 && error?.code === "organization_usage_limit_exceeded")
    return new TranslationProviderError("API_USAGE_LIMIT", "This OpenAI account has reached its API usage limit. Ask your administrator to review the account limits before trying again.");
  if (status === 429 && (error?.code === "insufficient_quota" || error?.type === "insufficient_quota"))
    return new TranslationProviderError("API_QUOTA", "OpenAI has no available API quota. Ask your administrator to check API billing, credits and project limits before trying again.");
  if (status === 429) return new TranslationProviderError("RATE_LIMITED", "OpenAI is receiving too many requests. Try again later.");
  if (status === 401) return new TranslationProviderError("API_AUTH", "OpenAI rejected the API key. Ask your administrator to check the server's translation configuration.");
  if (status === 403) return new TranslationProviderError("API_ACCESS", "OpenAI refused access for this request. Ask your administrator to check API project permissions and access restrictions.");
  if (status === 404) return new TranslationProviderError("MODEL_ACCESS", "This OpenAI project cannot use the configured translation model. Ask your administrator to check model access.");
  return new TranslationProviderError("PROVIDER_ERROR", "OpenAI could not translate this article. Ask your administrator to check the API configuration.");
}
export function parseTranslationResponse(value: unknown): TranslationSegment[] {
  if (!isObject(value) || value.status !== "completed" || !Array.isArray(value.output)) throw failure();
  const texts: string[] = [];
  for (const item of value.output) {
    if (!isObject(item) || item.type !== "message") continue;
    if (!Array.isArray(item.content)) throw failure();
    for (const part of item.content) {
      if (!isObject(part) || part.type !== "output_text" || typeof part.text !== "string") throw failure();
      texts.push(part.text);
    }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(texts.join("")); } catch { throw failure(); }
  if (!isObject(parsed) || !Array.isArray(parsed.segments) || parsed.segments.length > 300) throw failure();
  return parsed.segments.map(row => {
    if (!isObject(row) || typeof row.id !== "string" || typeof row.text !== "string" || row.text.length > 6000) throw failure();
    return { id: row.id, text: row.text };
  });
}

export class OpenaiTranslationProvider implements TranslationProvider {
  constructor(private readonly apiKey: string, readonly model = DEFAULT_TRANSLATION_MODEL) {
    if (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined)
      throw new TranslationProviderError("TEST_DISABLED", "Live translation providers are disabled under automated tests.");
  }
  checkConfiguration() {
    const configured = /^sk-[A-Za-z0-9_-]{20,}$/.test(this.apiKey) && /^[a-zA-Z0-9._-]{1,100}$/.test(this.model);
    return { configured, message: configured ? "OpenAI is configured. Generated Hebrew still needs human review." : "OpenAI translation configuration is incomplete." };
  }
  async translate(segments: TranslationSegment[]): Promise<TranslationSegment[]> {
    if (!this.checkConfiguration().configured) throw new TranslationProviderError("NOT_CONFIGURED", this.checkConfiguration().message);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
    const batches: TranslationSegment[][] = []; let batch: TranslationSegment[] = []; let chars = 0;
    for (const segment of segments) {
      if (batch.length && chars + segment.text.length > 6000) { batches.push(batch); batch = []; chars = 0; }
      batch.push(segment); chars += segment.text.length;
    }
    if (batch.length) batches.push(batch);
    const results: TranslationSegment[][] = []; let next = 0;
    try {
      const worker = async () => { try {
        while (next < batches.length) {
          if (controller.signal.aborted) throw new TranslationProviderError("CANCELED", "Translation stopped after an incomplete response. No draft was saved.");
          const index = next++;
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
            headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(translationRequest(this.model, batches[index])),
          });
          if (!response.ok) {
            let detail: unknown;
            try { detail = await readResponse(response); } catch { /* Use a safe status-only diagnosis. */ }
            throw translationHttpError(response.status, detail);
          }
          results[index] = parseTranslationResponse(await readResponse(response));
        }
      } catch (error) { controller.abort(); throw error; }
      };
      const work = await Promise.allSettled([worker(), worker()]);
      const rejected = work.find(result => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      return results.flat();
    } catch (error) {
      controller.abort();
      if (error instanceof TranslationProviderError) throw error;
      throw new TranslationProviderError("TIMEOUT_OR_NETWORK", "The translation could not finish. No draft was saved; you can try again.");
    } finally { clearTimeout(timer); }
  }
}
