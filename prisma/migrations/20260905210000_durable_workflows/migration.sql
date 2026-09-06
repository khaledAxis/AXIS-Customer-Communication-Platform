-- CreateEnum
CREATE TYPE "BackgroundJobKind" AS ENUM ('CRM_SYNC', 'AUTOMATION', 'DISPATCH');

-- CreateEnum
CREATE TYPE "BackgroundJobState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ATTENTION', 'CANCELED');

-- AlterEnum
ALTER TYPE "CampaignEventType" ADD VALUE 'ACCEPTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'REPORT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'CAMPAIGN_DISPATCHED';
ALTER TYPE "AuditAction" ADD VALUE 'CAMPAIGN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_CHANGED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "deliveryConfirmedCount" INTEGER,
ADD COLUMN     "dispatchApprovalId" TEXT,
ADD COLUMN     "dispatchDocument" JSONB;

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "kind" "BackgroundJobKind" NOT NULL,
    "state" "BackgroundJobState" NOT NULL DEFAULT 'PENDING',
    "resourceId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSchedule" (
    "key" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "actorUserId" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSchedule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SchedulerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastTickAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRateLimit" (
    "key" TEXT NOT NULL,
    "nextAvailableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProviderWebhookReceipt" (
    "providerEventId" TEXT NOT NULL,
    "normalizedEvent" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "effectsAppliedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderWebhookReceipt_pkey" PRIMARY KEY ("providerEventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_uniqueKey_key" ON "BackgroundJob"("uniqueKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_state_availableAt_idx" ON "BackgroundJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_state_leaseExpiresAt_idx" ON "BackgroundJob"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_kind_resourceId_idx" ON "BackgroundJob"("kind", "resourceId");

-- CreateIndex
CREATE INDEX "ProviderWebhookReceipt_processedAt_receivedAt_idx" ON "ProviderWebhookReceipt"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_providerMessageId_normalizedEmail_idx" ON "CampaignRecipient"("providerMessageId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_state_attemptCount_idx" ON "CampaignRecipient"("campaignId", "state", "attemptCount");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_occurredAt_idx" ON "CampaignEvent"("campaignId", "occurredAt");
