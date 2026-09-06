import { describe, expect, it } from "vitest";
import { readBoundedJson, readBoundedText } from "./boundedRequest";
describe("bounded webhook input", () => {
  it("preserves raw UTF-8, whitespace and key order for signature verification", async () => {
    const text = '{ "z": "עברית العربية", "a": 1 }\n';
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0,14)); controller.enqueue(bytes.slice(14)); controller.close();
    } });
    const request = new Request("https://example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBoundedText(request)).toBe(text);
  });
  it("refuses oversized streams rather than trusting content-length", async () => {
    await expect(readBoundedText(new Request("https://example.com", { method: "POST", body: "123456", headers: { "Content-Length": "1" } }),5)).rejects.toThrow("large");
  });
  it("rejects malformed JSON without changing persistence", async () => {
    await expect(readBoundedJson(new Request("https://example.com", { method: "POST", body: "{" }))).rejects.toThrow();
  });
});
