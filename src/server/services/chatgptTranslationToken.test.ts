import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatgptReceipt, verifyChatgptReceipt } from "./chatgptTranslationToken";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("article-bound ChatGPT preparation", () => {
  it("binds source, actor and article with an expiry", () => {
    vi.stubEnv("AUTH_SECRET", "synthetic-chatgpt-preparation-secret-32-plus");
    const token = createChatgptReceipt("article-a", "actor-a", "a".repeat(64));
    expect(verifyChatgptReceipt(token, "article-a", "actor-a")?.sourceHash).toBe("a".repeat(64));
    expect(verifyChatgptReceipt(token, "article-b", "actor-a")).toBeNull();
    expect(verifyChatgptReceipt(token, "article-a", "actor-b")).toBeNull();
    expect(verifyChatgptReceipt(token.slice(0, -5) + "xxxxx", "article-a", "actor-a")).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_001);
    expect(verifyChatgptReceipt(token, "article-a", "actor-a")).toBeNull();
  });
  it("refuses malformed receipts without parsing attacker-controlled payloads", () => {
    for (const value of ["", "a.b", "x".repeat(3000), "not-a-receipt"])
      expect(verifyChatgptReceipt(value, "a", "a")).toBeNull();
  });
});
