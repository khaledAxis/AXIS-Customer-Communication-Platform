import "server-only";
import { inTestRunner } from "../../db/prisma";
import { OpenaiTranslationProvider, DEFAULT_TRANSLATION_MODEL } from "./openaiTranslationProvider";
import { DisabledTranslationProvider, type TranslationProvider } from "./translationProvider";

let testProvider: TranslationProvider | undefined;
export function getTranslationProvider(): TranslationProvider {
  if (inTestRunner()) return testProvider ?? new DisabledTranslationProvider();
  if (process.env.TRANSLATION_ENABLED !== "true" || !process.env.OPENAI_API_KEY) return new DisabledTranslationProvider();
  const provider = new OpenaiTranslationProvider(process.env.OPENAI_API_KEY, process.env.TRANSLATION_OPENAI_MODEL || DEFAULT_TRANSLATION_MODEL);
  return provider.checkConfiguration().configured ? provider : new DisabledTranslationProvider();
}
export function setTranslationProviderForTesting(provider?: TranslationProvider) {
  if (!inTestRunner()) throw new Error("Translation test providers are unavailable outside automated tests.");
  testProvider = provider;
}
