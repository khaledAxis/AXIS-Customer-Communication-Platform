import "server-only";
import { jwtVerify } from "jose";
import { MONDAY_BOARDS } from "../../../domain/crm/mondayColumns";

export async function verifyMondayRequest(authorization: string | null): Promise<boolean> {
  const secret = process.env.MONDAY_SIGNING_SECRET ?? "";
  const account = process.env.MONDAY_ACCOUNT_ID ?? "";
  const origin = process.env.PUBLIC_APP_URL ?? "";
  if (process.env.MONDAY_WEBHOOK_ENABLED !== "true" || secret.length < 32 || !/^\d+$/.test(account) || !authorization) return false;
  try {
    const url = new URL("/api/webhooks/monday", origin);
    if (url.protocol !== "https:") return false;
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"], audience: url.href, requiredClaims: ["exp", "iat", "accountId"],
      maxTokenAge: "5 minutes", clockTolerance: 5,
    });
    return String(payload.accountId) === account;
  } catch { return false; }
}

export function parseMondayEvent(body: unknown) {
  if (!body || typeof body !== "object" || !("event" in body)) return null;
  const event = body.event;
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>;
  const scalarId = (value: unknown) => typeof value === "string" && /^\d{1,25}$/.test(value)
    ? value : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const boardId = scalarId(data.boardId);
  const itemId = scalarId(data.pulseId ?? data.itemId);
  const subscription = scalarId(data.subscriptionId);
  const trigger = data.triggerUuid;
  if (!boardId || !Object.values(MONDAY_BOARDS).some(id => id === boardId) || !itemId || !subscription ||
    typeof trigger !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(trigger) ||
    typeof data.type !== "string" || !/^[a-z_]{1,80}$/.test(data.type)) return null;
  return { mondayEventId: `${subscription}:${trigger}`, boardId, itemId, type: data.type };
}
