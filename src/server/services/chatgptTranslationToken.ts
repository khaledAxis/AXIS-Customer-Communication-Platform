import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

interface Receipt { id: string; actorId: string; sourceHash: string; expiresAt: number }
const purpose = "AXIS_CHATGPT_TRANSLATION_V1.";
function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("Translation preparation needs the server authentication configuration.");
  return value;
}
const signature = (payload: string) => createHmac("sha256", secret()).update(purpose + payload).digest();
export function createChatgptReceipt(id: string, actorId: string, sourceHash: string): string {
  const payload = Buffer.from(JSON.stringify({ id, actorId, sourceHash, expiresAt: Date.now() + 86_400_000 } satisfies Receipt)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyChatgptReceipt(token: string, id: string, actorId: string): Receipt | null {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, mac] = token.split(".");
  const actual = Buffer.from(mac, "base64url"); const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let receipt: unknown;
  try { receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (!receipt || typeof receipt !== "object" || !("id" in receipt) || receipt.id !== id ||
    !("actorId" in receipt) || receipt.actorId !== actorId || !("sourceHash" in receipt) || typeof receipt.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.sourceHash) || !("expiresAt" in receipt) || typeof receipt.expiresAt !== "number" ||
    receipt.expiresAt <= Date.now()) return null;
  return { id, actorId, sourceHash: receipt.sourceHash, expiresAt: receipt.expiresAt };
}
