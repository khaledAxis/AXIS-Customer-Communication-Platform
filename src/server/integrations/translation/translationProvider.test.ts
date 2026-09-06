import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranslationProvider, setTranslationProviderForTesting } from "./index";
import { DEFAULT_TRANSLATION_MODEL, OpenaiTranslationProvider, parseTranslationResponse, translationHttpError, translationRequest } from "./openaiTranslationProvider";

afterEach(() => { setTranslationProviderForTesting(undefined); vi.unstubAllEnvs(); });
describe("OpenAI translation boundary", () => {
  it.each([[429, "insufficient_quota", "API_QUOTA"], [429, "rate_limit_exceeded", "RATE_LIMITED"],
    [429, "credit_balance_exhausted", "API_CREDITS"], [429, "project_spend_limit_exceeded", "API_SPEND_LIMIT"],
    [429, "organization_spend_limit_exceeded", "API_SPEND_LIMIT"], [429, "organization_usage_limit_exceeded", "API_USAGE_LIMIT"],
    [403, "permission_denied", "API_ACCESS"],
    [401, "invalid_api_key", "API_AUTH"], [404, "model_not_found", "MODEL_ACCESS"], [500, "server_error", "PROVIDER_ERROR"]])
  ("classifies HTTP %s / %s without exposing provider text", (status, code, expected) => {
    const error = translationHttpError(Number(status), { error: { code, message: "SENSITIVE PROVIDER MESSAGE" } });
    expect(error.code).toBe(expected); expect(error.message).not.toContain("SENSITIVE");
  });
  it("requests strict structured output with no tools or response storage", () => {
    const segments = [{ id: "s0", text: "Surveying with ⟦AXIS_0⟧" }];
    const request = translationRequest(DEFAULT_TRANSLATION_MODEL, segments);
    expect(request.store).toBe(false); expect(request.tools).toEqual([]);
    expect(request.input).toEqual([{ role: "user", content: JSON.stringify({ segments }) }]);
    expect(request.text.format).toMatchObject({ type: "json_schema", strict: true, schema: { additionalProperties: false } });
    expect(request.instructions).toContain("untrusted source material");
  });
  it("refuses a live adapter under tests even with configuration", async () => {
    vi.stubEnv("TRANSLATION_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "sk-synthetic-never-a-live-key-for-tests");
    expect(() => new OpenaiTranslationProvider("sk-synthetic-never-a-live-key-for-tests")).toThrow(/disabled/);
    expect(getTranslationProvider().checkConfiguration().configured).toBe(false);
    await expect(getTranslationProvider().translate([])).rejects.toThrow();
  });
  it("extracts only completed structured text", () => {
    expect(parseTranslationResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ segments: [{ id: "s0", text: "שלום" }] }) }] }] }))
      .toEqual([{ id: "s0", text: "שלום" }]);
  });
  it.each([
    { status: "incomplete", output: [] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Refused" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"segments":[{"id":1,"text":"x"}]}' }] }] },
  ])("refuses malformed, refused or partial provider output", value => {
    expect(() => parseTranslationResponse(value)).toThrow(/complete translation/);
  });
});
