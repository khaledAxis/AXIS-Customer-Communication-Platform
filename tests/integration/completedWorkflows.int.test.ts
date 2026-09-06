import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getPrisma } from "../../src/server/db/prisma";
import { actAs, clearTestActor, createTestUser, type TestUser } from "../support/actor";
import { Capability, requireCapability } from "../../src/server/auth/session";
import { createNewsletter, addContent, getNewsletter, buildNewsletterDocument, updateNewsletterDetails } from "../../src/server/services/newsletterService";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import { createSegment } from "../../src/server/services/segmentService";
import { prepareFinalAudience, approveForProduction, revokeProductionApproval } from "../../src/server/services/sendReadinessService";
import { scheduleCustomerDelivery, getCustomerReleaseStatus, rescheduleCustomerDelivery, cancelCustomerDelivery } from "../../src/server/services/productionDispatchService";
import { dispatchCampaign } from "../../src/server/services/deliveryService";
import { setProductionEmailProviderForTesting, type ProductionEmailMessage, type ProductionEmailProvider } from "../../src/server/integrations/email";
import * as infrastructure from "../../src/server/services/emailInfrastructureService";
import { ingestProviderEvent, reconcileProviderReceipts } from "../../src/server/services/providerEventService";
import { getCampaignReport, exportCampaignReport, getDeliveryReport } from "../../src/server/services/reportService";
import { configureCrmSchedule, enqueueDueJobs, schedulerAuthorized } from "../../src/server/services/jobService";
import { claimJob, finishJob, heartbeatJob, recoverExpiredJobs } from "../../src/server/db/repositories/jobRepository";
import { withinClaimedJob } from "../../src/server/jobs/context";
import { receiveMondayWebhook } from "../../src/server/services/mondayWebhookService";
import { verifyMondayRequest } from "../../src/server/integrations/crm/mondayWebhook";
import { MONDAY_BOARDS } from "../../src/domain/crm/mondayColumns";
import { Operator } from "../../src/domain/segment/segmentFields";

const prisma = getPrisma();
const prefix = "completion-" + randomUUID().slice(0,8);
const emails = [0,1].map(n => `${prefix}-${n}@fixture.invalid`);
const campaigns: string[] = [];
let creator: TestUser, approver: TestUser, contentId: string, segmentId: string;
const send = vi.fn(async (message: ProductionEmailMessage) => ({ outcome: "ACCEPTED" as const, providerMessageId: `${prefix}-${randomUUID()}`, message: "Accepted", to: message.to }));
const provider: ProductionEmailProvider = {
  name: "RESEND", send: async () => { throw new Error("Pilot path forbidden in these tests."); }, sendCustomer: send,
  checkConfiguration: () => ({ configured: true, enabled: true, name: "RESEND", problems: [], senderEmail: "newsletter@axis-gps.com",
    domain: { domain: "axis-gps.com", spf: "VERIFIED", dkim: "VERIFIED", dmarc: "UNKNOWN", requiredDnsRecords: [] } }),
  verifyWebhook: () => ({ ok: false, reason: "UNSIGNED", message: "Fixture" }),
};
async function approved() {
  actAs(creator);
  const result = await createNewsletter({ name: `${prefix} newsletter`, subject: "עדכון בדיקה", language: "HE" });
  if (!result.ok) throw new Error("Fixture draft failed");
  const id = result.data.id; campaigns.push(id);
  await addContent(id, contentId); await setCampaignSegment(id, segmentId); await prepareFinalAudience(id, randomUUID());
  actAs(approver); expect((await approveForProduction(id)).ok).toBe(true); actAs(creator);
  return id;
}
async function scheduled() {
  const id = await approved();
  // Other integration fixtures update the shared synthetic CRM concurrently. The
  // global watermark deliberately refuses that handoff; repeat the same unchanged
  // user instruction, without bypassing readiness or preparing a different audience.
  for (let attempt=0;;attempt++) {
    try { await scheduleCustomerDelivery(id, "SEND 2 CUSTOMERS", new Date()); return id; }
    catch (error) {
      if (attempt >= 30 || !(error instanceof Error) || !error.message.startsWith("Newsletter, approval or audience changed")) throw error;
      await new Promise(resolve => setTimeout(resolve,100));
    }
  }
}
const datedJob = (kind: "CRM_SYNC" | "AUTOMATION" | "DISPATCH", resourceId = randomUUID()) => prisma.backgroundJob.create({ data: {
  kind, resourceId, uniqueKey: `${prefix}:${randomUUID()}`, actorUserId: creator.id, scheduledFor: new Date("2000-01-01"), availableAt: new Date("2000-01-01"),
} });

describe("completed delivery, jobs, Monday and reporting workflows", () => {
  beforeAll(async () => {
    creator = await createTestUser({ prefix: `${prefix}-creator`, role: "ADMIN" });
    approver = await createTestUser({ prefix: `${prefix}-approver`, role: "MANAGER" }); actAs(creator);
    for (const [i,email] of emails.entries()) {
      await prisma.company.create({ data: { mondayBoardId: prefix, mondayItemId: String(i), name: `${prefix} ${i}`, companyEmail: email, companyEmailNorm: email, customerStatus: "ACTIVE" } });
      await prisma.communicationAddress.create({ data: { normalizedEmail: email, consentStatus: "GRANTED", language: "HE", emailStatus: "VALID" } });
    }
    contentId = (await prisma.contentItem.create({ data: { title: prefix, bodyHtml: "<p>Original approved copy</p>", language: "HE", origin: "INTERNAL", reviewState: "APPROVED" } })).id;
    segmentId = await createSegment({ name: prefix, definition: { version: 1, conditions: [{ field: "company.name", operator: Operator.STARTS_WITH, value: prefix }], groups: [], include: { companyEmails: true, contactEmails: false } } });
  });
  beforeEach(async () => {
    actAs(creator); send.mockClear(); setProductionEmailProviderForTesting(provider);
    for (const [key,value] of Object.entries({ PRODUCTION_DELIVERY_ENABLED: "true", SEND_MODE: "PRODUCTION", AXIS_DELIVERY_RELEASE_APPROVED: "true",
      PRODUCTION_DOMAIN_REVIEW_CONFIRMED: "true", PUBLIC_APP_URL: "https://news.axis-gps.com", NEWSLETTER_REPLY_TO: "noreply@axis-gps.com",
      RESEND_WEBHOOK_SECRET: "whsec_synthetic_testing_only", SCHEDULER_ENABLED: "true", SCHEDULER_TRIGGER_SECRET: "s".repeat(40),
      MONDAY_WEBHOOK_ENABLED: "true", MONDAY_ACCOUNT_ID: "12345", MONDAY_SIGNING_SECRET: "m".repeat(40) })) vi.stubEnv(key,value);
    vi.spyOn(infrastructure, "readStoredDomainStatus").mockResolvedValue({ status: { domain: "axis-gps.com", providerStatus: "verified", spf: "VERIFIED", dkim: "VERIFIED", dmarc: "UNKNOWN", verified: true, records: [] }, checkedAt: new Date() });
    await prisma.schedulerHeartbeat.upsert({ where: { id: "scheduler" }, create: { id: "scheduler", lastTickAt: new Date() }, update: { lastTickAt: new Date() } });
    await prisma.communicationAddress.updateMany({ where: { normalizedEmail: { in: emails } }, data: { consentStatus: "GRANTED", emailStatus: "VALID", language: "HE" } });
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: emails } } });
    await prisma.company.updateMany({ where: { mondayBoardId: prefix }, data: { archivedAt: null } });
    await prisma.contentItem.update({ where: { id: contentId }, data: { origin: "INTERNAL", reviewState: "APPROVED" } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setProductionEmailProviderForTesting(undefined); });
  afterAll(async () => {
    clearTestActor();
    await prisma.backgroundJob.deleteMany({ where: { actorUserId: { in: [creator.id, approver.id] } } });
    await prisma.jobSchedule.deleteMany({ where: { actorUserId: creator.id } });
    await prisma.mondayWebhookEvent.deleteMany({ where: { mondayEventId: { startsWith: "123:" + prefix } } });
    await prisma.providerWebhookReceipt.deleteMany({ where: { providerEventId: { startsWith: prefix } } });
    await prisma.campaignEvent.deleteMany({ where: { campaignId: { in: campaigns } } });
    await prisma.campaignRecipientSource.deleteMany({ where: { recipient: { campaignId: { in: campaigns } } } });
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: { in: campaigns } } });
    await prisma.campaignTestSend.deleteMany({ where: { campaignId: { in: campaigns } } });
    await prisma.campaignProductionApproval.deleteMany({ where: { campaignId: { in: campaigns } } });
    await prisma.campaignFinalAudience.deleteMany({ where: { campaignId: { in: campaigns } } });
    await prisma.unsubscribeToken.deleteMany({ where: { normalizedEmail: { in: emails } } });
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: emails } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: [creator.id, approver.id] } }, { entityId: { in: campaigns } }, { metadata: { path: ["providerEventId"], string_starts_with: prefix } }] } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
    await prisma.contentItem.delete({ where: { id: contentId } }); await prisma.segment.delete({ where: { id: segmentId } });
    await prisma.company.deleteMany({ where: { mondayBoardId: prefix } });
    await prisma.communicationAddress.deleteMany({ where: { normalizedEmail: { in: emails } } });
    await prisma.user.deleteMany({ where: { id: { in: [creator.id, approver.id] } } });
  });

  it("requires independent release gates and an exact typed audience count", async () => {
    const id = await approved();
    await expect(scheduleCustomerDelivery(id, "SEND 3 CUSTOMERS", new Date())).rejects.toThrow("SEND 2");
    vi.stubEnv("AXIS_DELIVERY_RELEASE_APPROVED", "false");
    expect((await getCustomerReleaseStatus()).enabled).toBe(false);
    await expect(scheduleCustomerDelivery(id, "SEND 2 CUSTOMERS", new Date())).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("unknown consent remains planning-only and cannot authorize customer submission", async () => {
    await prisma.communicationAddress.updateMany({ where: { normalizedEmail: emails[0] }, data: { consentStatus: "UNKNOWN" } });
    const id = await approved();
    await expect(scheduleCustomerDelivery(id, "SEND 2 CUSTOMERS", new Date())).rejects.toThrow("consent");
    expect(send).not.toHaveBeenCalled();
  });
  it("freezes content, locks editing and vetoes an unsubscribe received after scheduling", async () => {
    const id = await scheduled();
    const before = buildNewsletterDocument((await getNewsletter(id))!);
    await prisma.contentItem.update({ where: { id: contentId }, data: { title: "Changed later" } });
    expect(buildNewsletterDocument((await getNewsletter(id))!)).toEqual(before);
    await expect(setCampaignSegment(id, null)).rejects.toThrow();
    await expect(updateNewsletterDetails(id, { name: "Changed", subject: "Changed", language: "HE" })).rejects.toThrow();
    await prisma.unsubscribe.create({ data: { normalizedEmail: emails[1], source: "RECIPIENT_LINK", scope: "GLOBAL" } });
    const result = await dispatchCampaign(id); expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].to).toBe(emails[0]);
    expect(send.mock.calls[0][0].html).toContain("/unsubscribe/");
    expect((await getCampaignReport(id))?.metrics).toMatchObject({ accepted: 1, delivered: 0, suppressed: 1 });
  });
  it("retains early events, deduplicates replays and computes unique engagement correctly", async () => {
    const id = await scheduled();
    const eventId = `${prefix}-early-${randomUUID()}`; const messageId = `${prefix}-message-${randomUUID()}`;
    send.mockImplementationOnce(async message => {
      await ingestProviderEvent({ providerEventId: eventId, providerMessageId: messageId, normalizedEmail: message.to, type: "DELIVERED", occurredAt: new Date() });
      return { outcome: "ACCEPTED", providerMessageId: messageId, message: "Accepted", to: message.to };
    });
    await dispatchCampaign(id);
    expect((await getCampaignReport(id))?.metrics.delivered).toBe(1);
    const base = { providerMessageId: messageId, normalizedEmail: emails[0], occurredAt: new Date() };
    await Promise.all(Array.from({ length: 5 }, () => ingestProviderEvent({ ...base, providerEventId: `${eventId}-open`, type: "OPENED" })));
    await ingestProviderEvent({ ...base, providerEventId: `${eventId}-open-again`, type: "OPENED" });
    await ingestProviderEvent({ ...base, providerEventId: `${eventId}-click`, type: "CLICKED" });
    await ingestProviderEvent({ ...base, providerEventId: `${eventId}-accepted`, type: "ACCEPTED" });
    expect((await getCampaignReport(id))?.metrics).toMatchObject({ accepted: 2, delivered: 1, opened: 1, clicked: 1 });
    expect(await prisma.campaignEvent.count({ where: { campaignId: id, type: "ACCEPTED" } })).toBe(1);
    expect(await prisma.campaignEvent.count({ where: { campaignId: id, type: "DELIVERED" } })).toBe(1);
    expect(await exportCampaignReport(id)).toContain('"Accepted UTC"');
    expect((await getDeliveryReport()).campaigns.length).toBeLessThanOrEqual(20);
  });
  it("never resubmits an uncertain provider outcome, even on concurrent repeated dispatch", async () => {
    const id = await scheduled(); send.mockImplementationOnce(async () => { throw new Error("Network timeout"); });
    await Promise.allSettled([dispatchCampaign(id), dispatchCampaign(id)]);
    await dispatchCampaign(id); await dispatchCampaign(id);
    expect(send.mock.calls.filter(([message]) => message.to === emails[0])).toHaveLength(1);
    expect(send.mock.calls.filter(([message]) => message.to === emails[1])).toHaveLength(1);
    expect((await getCampaignReport(id))?.metrics.uncertain).toBe(1);
  });
  it("refuses queued content whose external review has since been revoked", async () => {
    const id = await scheduled();
    await prisma.contentItem.update({ where: { id: contentId }, data: { origin: "INGESTED", reviewState: "REJECTED" } });
    expect((await dispatchCampaign(id)).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.campaignRecipient.count({ where: { campaignId: id, attemptCount: { gt: 0 } } })).toBe(0);
  });
  it("reconciles early pilot receipts without creating customer delivery history", async () => {
    const id = await approved();
    const providerEventId = `${prefix}-pilot-event`, providerMessageId = `${prefix}-pilot-message`;
    await ingestProviderEvent({ providerEventId, providerMessageId, normalizedEmail: emails[0], type: "DELIVERED", occurredAt: new Date() });
    expect((await prisma.providerWebhookReceipt.findUniqueOrThrow({ where: { providerEventId } })).processedAt).toBeNull();
    await prisma.campaignTestSend.create({ data: { campaignId: id, requestedById: creator.id,
      fromEmail: "newsletter@axis-gps.com", toEmail: emails[0], channel: "PROVIDER_PILOT", providerMessageId } });
    await reconcileProviderReceipts();
    expect((await prisma.providerWebhookReceipt.findUniqueOrThrow({ where: { providerEventId } })).processedAt).not.toBeNull();
    expect(await prisma.campaignEvent.count({ where: { campaignId: id } })).toBe(0);
    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(0);
  });
  it("rechecks CRM changes and consent between submissions within one batch", async () => {
    const id = await scheduled();
    send.mockImplementationOnce(async message => {
      await prisma.company.updateMany({ where: { companyEmailNorm: emails[1] }, data: { archivedAt: new Date() } });
      return { outcome: "ACCEPTED", providerMessageId: `${prefix}-${randomUUID()}`, message: "Accepted", to: message.to };
    });
    await dispatchCampaign(id); expect(send).toHaveBeenCalledTimes(1);
    expect((await getCampaignReport(id))?.metrics.suppressed).toBe(1);
  });
  it("does not guess a campaign for an unmatched message id", async () => {
    const id = await scheduled(); await dispatchCampaign(id);
    await ingestProviderEvent({ providerEventId: `${prefix}-orphan`, providerMessageId: "unknown-message", normalizedEmail: emails[0], type: "OPENED", occurredAt: new Date() });
    await reconcileProviderReceipts(); expect((await getCampaignReport(id))?.metrics.opened).toBe(0);
  });
  it("refuses revoked approvals and requires explicit review after a missed start window", async () => {
    const id = await scheduled(); await revokeProductionApproval(id);
    expect((await dispatchCampaign(id)).ok).toBe(false); expect(send).not.toHaveBeenCalled();
    const late = await scheduled(); await prisma.campaign.update({ where: { id: late }, data: { scheduledAt: new Date(Date.now()-600000) } });
    expect((await dispatchCampaign(late)).ok).toBe(false);
    await prisma.backgroundJob.update({ where: { uniqueKey: `dispatch:${late}` }, data: { state: "ATTENTION" } });
    await rescheduleCustomerDelivery(late, "SEND 2 CUSTOMERS", new Date(Date.now()+60000));
    await cancelCustomerDelivery(late); expect((await getNewsletter(late))?.status).toBe("CANCELED");
  });
  it("claims a job once and validates lease, actor and capability on every delegated operation", async () => {
    const job = await datedJob("AUTOMATION");
    const claims = (await Promise.all([claimJob(),claimJob(),claimJob()])).filter(row => row?.id === job.id);
    expect(claims).toHaveLength(1); const claimed = claims[0]!;
    await withinClaimedJob(job.id, claimed.leaseToken!, async () => {
      expect((await requireCapability(Capability.MANAGE_NEWSLETTERS)).id).toBe(creator.id);
      await expect(requireCapability(Capability.APPROVE_PRODUCTION)).rejects.toThrow();
      await prisma.user.update({ where: { id: creator.id }, data: { isActive: false } });
      await expect(requireCapability(Capability.MANAGE_NEWSLETTERS)).rejects.toThrow();
      await prisma.user.update({ where: { id: creator.id }, data: { isActive: true } });
    });
    await expect(withinClaimedJob(job.id, "forged-lease", () => requireCapability(Capability.MANAGE_NEWSLETTERS))).rejects.toThrow();
    expect(await heartbeatJob(claimed)).toBe(true); await finishJob(claimed,"SUCCEEDED");
    expect(await heartbeatJob(claimed)).toBe(false);
  });
  it("recovers an expired delivery lease to attention and never retries the in-flight recipient", async () => {
    const id = await scheduled();
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: id } });
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { state: "SENDING", attemptCount: 1 } });
    await prisma.backgroundJob.update({ where: { uniqueKey: `dispatch:${id}` }, data: { state: "RUNNING", leaseToken: "lost", leaseExpiresAt: new Date(0) } });
    await recoverExpiredJobs();
    expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).state).toBe("UNCERTAIN");
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { uniqueKey: `dispatch:${id}` } })).state).toBe("ATTENTION");
  });
  it("serializes different queue rows targeting the same resource", async () => {
    const resource = randomUUID();
    const first = await datedJob("AUTOMATION", resource);
    const second = await datedJob("AUTOMATION", resource);
    const claims = (await Promise.all([claimJob(), claimJob(), claimJob()])).filter(job => job?.resourceId === resource);
    expect(claims).toHaveLength(1);
    expect(await prisma.backgroundJob.count({ where: { id: { in: [first.id, second.id] }, state: "RUNNING" } })).toBe(1);
    await finishJob(claims[0]!, "SUCCEEDED");
    const next = await claimJob();
    expect(next?.resourceId).toBe(resource);
    expect(next?.id).not.toBe(claims[0]!.id);
    await finishJob(next!, "SUCCEEDED");
  });
  it("authenticates Monday JWTs, rejects tampering and coalesces duplicate notifications", async () => {
    expect(schedulerAuthorized("Bearer " + "s".repeat(40))).toBe(true); expect(schedulerAuthorized("Bearer wrong")).toBe(false);
    await configureCrmSchedule(true, 60);
    const body = { event: { boardId: MONDAY_BOARDS.CUSTOMERS, pulseId: 1234, subscriptionId: 123, triggerUuid: prefix + "-event", type: "update_column_value" } };
    const token = await new SignJWT({ accountId: 12345 }).setProtectedHeader({ alg: "HS256" }).setAudience("https://news.axis-gps.com/api/webhooks/monday")
      .setIssuedAt().setExpirationTime("2m").sign(new TextEncoder().encode("m".repeat(40)));
    expect(await verifyMondayRequest(token)).toBe(true); expect(await verifyMondayRequest(token + "tampered")).toBe(false);
    expect((await receiveMondayWebhook({ challenge: "challenge_123" }, null)).body).toEqual({ challenge: "challenge_123" });
    expect((await receiveMondayWebhook(body,null)).status).toBe(401);
    await Promise.all([receiveMondayWebhook(body,token),receiveMondayWebhook(body,token)]);
    expect(await prisma.mondayWebhookEvent.count({ where: { mondayEventId: "123:" + prefix + "-event" } })).toBe(1);
    expect(await prisma.backgroundJob.count({ where: { actorUserId: creator.id, uniqueKey: { startsWith: "webhook:" } } })).toBe(1);
    await enqueueDueJobs(); await enqueueDueJobs();
    expect(await prisma.backgroundJob.count({ where: { actorUserId: creator.id, uniqueKey: { startsWith: "crm:" } } })).toBe(1);
    vi.stubEnv("MONDAY_ACCOUNT_ID", "54321"); expect(await verifyMondayRequest(token)).toBe(false);
  });
});
