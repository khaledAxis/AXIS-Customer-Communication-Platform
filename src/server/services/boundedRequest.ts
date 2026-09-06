import "server-only";
export async function readBoundedText(request: Request, limit = 262144): Promise<string> {
  if (!request.body) throw new Error("Missing body.");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Body too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readBoundedJson(request: Request, limit = 262144): Promise<unknown> {
  return JSON.parse(await readBoundedText(request, limit));
}
