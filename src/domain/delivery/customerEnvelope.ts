import { normalizeEmail } from "../email/normalizeEmail";
import { hasHeaderInjection } from "../send/testSendPolicy";

export function assertCustomerEnvelope(message: { to: string; subject: string; idempotencyKey: string }): string {
  const raw = message as unknown as Record<string, unknown>;
  if (["from", "cc", "bcc", "replyTo", "reply_to"].some(key => key in raw))
    throw new Error("Customer delivery does not accept additional envelope fields.");
  const email = normalizeEmail(message.to);
  if (typeof message.to !== "string" || hasHeaderInjection(message.to) || /[,;<>\"]/.test(message.to) ||
      email.kind !== "valid" || email.normalized !== message.to || hasHeaderInjection(message.subject) ||
      !/^axis-customer-[a-f0-9]{64}$/.test(message.idempotencyKey))
    throw new Error("Invalid customer delivery envelope.");
  return message.to;
}
