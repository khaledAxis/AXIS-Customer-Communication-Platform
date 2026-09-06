import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
import { fetchArticleImage, MAX_FEED_BYTES } from "./feedFetcher";

describe("explicit article picture download", () => {
  beforeEach(() => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it("preserves binary bytes and requests no credentials or redirects", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0]);
    mocks.fetch.mockResolvedValue(new Response(bytes));
    const result = await fetchArticleImage("https://pictures.example.com/photo.png");
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.bytes]).toEqual([...bytes]);
    expect(mocks.fetch).toHaveBeenCalledWith("https://pictures.example.com/photo.png",
      expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
  });

  it("refuses nonpublic URLs before a request", async () => {
    expect((await fetchArticleImage("http://127.0.0.1/photo.png")).ok).toBe(false);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses a public name with any private DNS answer", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34" }, { address: "10.0.0.1" }]);
    expect((await fetchArticleImage("https://pictures.example.com/photo.png")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stops an oversized stream even without a length header", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_FEED_BYTES + 1)); }, cancel,
    });
    mocks.fetch.mockResolvedValue(new Response(stream));
    expect((await fetchArticleImage("https://pictures.example.com/photo.png")).ok).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports a refused redirect without making another request", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("redirect refused"));
    expect((await fetchArticleImage("https://pictures.example.com/photo.png")).ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
