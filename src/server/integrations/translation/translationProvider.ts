import "server-only";
import type { TranslationSegment } from "../../../domain/content/hebrewTranslation";

export interface TranslationProvider {
  readonly model: string;
  checkConfiguration(): { configured: boolean; message: string };
  translate(segments: TranslationSegment[]): Promise<TranslationSegment[]>;
}
export class TranslationProviderError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export class DisabledTranslationProvider implements TranslationProvider {
  readonly model = "disabled";
  checkConfiguration() { return { configured: false, message: "Hebrew translation needs an OpenAI API key and must be enabled by your administrator." }; }
  async translate(): Promise<TranslationSegment[]> {
    throw new TranslationProviderError("NOT_CONFIGURED", this.checkConfiguration().message);
  }
}
