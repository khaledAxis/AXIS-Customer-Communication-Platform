import "server-only";
import { getPrisma } from "../db/prisma";
import { parseMondayEvent, verifyMondayRequest } from "../integrations/crm/mondayWebhook";

export async function receiveMondayWebhook(body: unknown, authorization: string | null) {
  if (process.env.MONDAY_WEBHOOK_ENABLED !== "true") return { status: 503, body: { status: "unavailable" } };
  // Monday's challenge is a control-of-URL handshake. It changes no data and grants no authority.
  if (body && typeof body === "object" && Object.keys(body).length === 1 && "challenge" in body &&
      typeof body.challenge === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(body.challenge))
    return { status: 200, body: { challenge: body.challenge } };
  if (!await verifyMondayRequest(authorization)) return { status: 401, body: { status: "unavailable" } };
  const event = parseMondayEvent(body);
  if (!event) return { status: 400, body: { status: "unavailable" } };
  const prisma = getPrisma();
  const schedule = await prisma.jobSchedule.findUnique({ where: { key: "CRM_RECONCILIATION" } });
  if (!schedule?.isEnabled) return { status: 503, body: { status: "unavailable" } };
  // All events in one minute share one FUTURE reconciliation. Payload fields never modify CRM rows.
  const due = new Date((Math.floor(Date.now() / 60000) + 1) * 60000);
  await prisma.$transaction(async tx => {
    const inserted = await tx.mondayWebhookEvent.createMany({
      data: [{ ...event, payload: event, status: "QUEUED" }], skipDuplicates: true,
    });
    if (!inserted.count) return;
    await tx.backgroundJob.createMany({ data: [{ uniqueKey: `webhook:${due.toISOString()}`,
      kind: "CRM_SYNC", actorUserId: schedule.actorUserId, scheduledFor: due, availableAt: due }], skipDuplicates: true });
  });
  return { status: 200, body: { status: "accepted" } };
}
