-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "CrmSource" AS ENUM ('MONDAY');

-- CreateEnum
CREATE TYPE "CrmBoardKind" AS ENUM ('CUSTOMERS', 'CONTACTS', 'PRODUCTS', 'CUSTOMER_PRODUCTS');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('HE', 'AR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('UNKNOWN', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "CompanyCrmStatus" AS ENUM ('POTENTIAL', 'ACTIVE', 'INACTIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "SendMode" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CampaignRecipientState" AS ENUM ('PENDING', 'READY', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TestSendState" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailSourceType" AS ENUM ('COMPANY_EMAIL', 'CONTACT_EMAIL');

-- CreateEnum
CREATE TYPE "ExclusionReason" AS ENUM ('NO_EMAIL', 'INVALID_EMAIL', 'UNSUBSCRIBED', 'SUPPRESSED', 'CONSENT_DENIED', 'COMPANY_INACTIVE', 'ARCHIVED', 'LANGUAGE_UNKNOWN');

-- CreateEnum
CREATE TYPE "CampaignEventType" AS ENUM ('DELIVERED', 'OPENED', 'CLICKED', 'BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'DEFERRED', 'DROPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL', 'PROVIDER_PERMANENT');

-- CreateEnum
CREATE TYPE "UnsubscribeScope" AS ENUM ('GLOBAL');

-- CreateEnum
CREATE TYPE "UnsubscribeSource" AS ENUM ('RECIPIENT_LINK', 'MANUAL', 'PROVIDER_WEBHOOK', 'IMPORT');

-- CreateEnum
CREATE TYPE "ContentOrigin" AS ENUM ('INTERNAL', 'INGESTED');

-- CreateEnum
CREATE TYPE "ContentSourceKind" AS ENUM ('INTERNAL', 'RSS', 'WEBSITE', 'API', 'MANUAL_EXTERNAL');

-- CreateEnum
CREATE TYPE "ContentReviewState" AS ENUM ('NEW', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('ASSISTED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'PREPARING', 'PREPARED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'BOOTSTRAP');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncItemAction" AS ENUM ('UPSERT', 'ARCHIVE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncItemClass" AS ENUM ('SENDABLE', 'INCOMPLETE', 'NO_EMAIL', 'INVALID_EMAIL', 'CONFLICT', 'ERROR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CAMPAIGN_CREATED', 'CAMPAIGN_SUBMITTED', 'CAMPAIGN_APPROVED', 'CAMPAIGN_REJECTED', 'CAMPAIGN_SCHEDULED', 'CAMPAIGN_SENT', 'CAMPAIGN_CANCELED', 'SEND_MODE_CHANGED', 'PRODUCTION_ENABLED', 'UNSUBSCRIBE', 'SUPPRESSION', 'CRM_SYNC', 'ADMIN_CHANGE');

-- CreateTable
CREATE TABLE "CommunicationAddress" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'UNKNOWN',
    "language" "Language" NOT NULL DEFAULT 'UNKNOWN',
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "source" "CrmSource" NOT NULL DEFAULT 'MONDAY',
    "mondayUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "mondayDeletedAt" TIMESTAMP(3),
    "rawItem" JSONB,
    "name" TEXT,
    "companyNumber" TEXT,
    "hashavshevetId" TEXT,
    "accountKey" TEXT,
    "companyEmail" TEXT,
    "companyEmailNorm" TEXT,
    "accountingEmail" TEXT,
    "companyPhone" TEXT,
    "category" TEXT,
    "customerStatus" "CompanyCrmStatus" NOT NULL DEFAULT 'UNKNOWN',
    "customerStatusRaw" TEXT,
    "city" TEXT,
    "address" TEXT,
    "industryId" TEXT,
    "classificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "source" "CrmSource" NOT NULL DEFAULT 'MONDAY',
    "mondayUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "mondayDeletedAt" TIMESTAMP(3),
    "rawItem" JSONB,
    "fullName" TEXT,
    "email" TEXT,
    "emailNorm" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assertedBy" "CrmBoardKind" NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "mondayColumnId" TEXT NOT NULL,
    "mondayLabelIndex" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "colorVarName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerClassification" (
    "id" TEXT NOT NULL,
    "mondayColumnId" TEXT NOT NULL,
    "mondayLabelIndex" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "name" TEXT,
    "itemKey" TEXT,
    "sku" TEXT,
    "catalogLink" TEXT,
    "itemType" TEXT,
    "rawItem" JSONB,
    "syncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProduct" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "productId" TEXT,
    "status" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "hardwareWarrantyUntil" TIMESTAMP(3),
    "softwareWarrantyUntil" TIMESTAMP(3),
    "subscriptionUntil" TIMESTAMP(3),
    "subscriptionLoginId" TEXT,
    "billingType" TEXT,
    "includesCommsPackage" BOOLEAN,
    "simCount" INTEGER,
    "rawItem" JSONB,
    "syncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MANAGER',
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "language" "Language" NOT NULL DEFAULT 'UNKNOWN',
    "origin" "ContentOrigin" NOT NULL DEFAULT 'INTERNAL',
    "reviewState" "ContentReviewState" NOT NULL DEFAULT 'APPROVED',
    "subject" TEXT,
    "preheader" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "sourceId" TEXT,
    "sourceName" TEXT,
    "author" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sendMode" "SendMode" NOT NULL DEFAULT 'TEST',
    "segmentId" TEXT,
    "snapshotSubject" TEXT,
    "snapshotPreheader" TEXT,
    "snapshotBodyHtml" TEXT,
    "snapshotBodyText" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignContentItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "customHeading" TEXT,
    "customIntro" TEXT,
    "snapshotTitle" TEXT,
    "snapshotBodyHtml" TEXT,
    "snapshotBodyText" TEXT,
    "snapshotExternalUrl" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ContentSourceKind" NOT NULL,
    "baseUrl" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentIngestionRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterAutomation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "AutomationMode" NOT NULL DEFAULT 'ASSISTED',
    "cadence" "Cadence" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "weekOfMonth" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "recurrence" JSONB,
    "language" "Language" NOT NULL,
    "segmentId" TEXT,
    "nextScheduledAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterAutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "generatedCampaignId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "communicationAddressId" TEXT,
    "intendedEmail" TEXT NOT NULL,
    "state" "CampaignRecipientState" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "firstClickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipientSource" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "sourceBoardId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceEntityType" "CrmBoardKind" NOT NULL,
    "emailSourceType" "EmailSourceType" NOT NULL,
    "sourceEmailRaw" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipientSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAudienceSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedRecords" INTEGER NOT NULL,
    "withCandidateEmail" INTEGER NOT NULL,
    "eligible" INTEGER NOT NULL,
    "uniqueDestinations" INTEGER NOT NULL,
    "excluded" INTEGER NOT NULL,
    "duplicateSourcesCollapsed" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "CampaignAudienceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAudienceExclusion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceBoardId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceEntityType" "CrmBoardKind" NOT NULL,
    "emailSourceType" "EmailSourceType",
    "sourceEmailRaw" TEXT,
    "normalizedEmail" TEXT,
    "reason" "ExclusionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAudienceExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTestSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "simulatedNormalizedEmail" TEXT,
    "simulatedSourceBoardId" TEXT,
    "simulatedSourceItemId" TEXT,
    "subjectSnapshot" TEXT,
    "state" "TestSendState" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CampaignTestSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "normalizedEmail" TEXT,
    "type" "CampaignEventType" NOT NULL,
    "providerEventId" TEXT,
    "providerMessageId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unsubscribe" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "scope" "UnsubscribeScope" NOT NULL DEFAULT 'GLOBAL',
    "source" "UnsubscribeSource" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "communicationAddressId" TEXT,
    "campaignId" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "tokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unsubscribe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "communicationAddressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEvent" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "providerEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MondayBoard" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "kind" "CrmBoardKind" NOT NULL,
    "name" TEXT,
    "columnMapping" JSONB,
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MondayBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "mondayBoardId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "archivedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncItemLog" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "mondayItemId" TEXT NOT NULL,
    "action" "SyncItemAction" NOT NULL,
    "classification" "SyncItemClass",
    "message" TEXT,
    "rawItem" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncItemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MondayWebhookEvent" (
    "id" TEXT NOT NULL,
    "mondayEventId" TEXT,
    "boardId" TEXT,
    "itemId" TEXT,
    "type" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" TEXT,

    CONSTRAINT "MondayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "fromState" TEXT,
    "toState" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationAddress_normalizedEmail_key" ON "CommunicationAddress"("normalizedEmail");

-- CreateIndex
CREATE INDEX "CommunicationAddress_emailStatus_idx" ON "CommunicationAddress"("emailStatus");

-- CreateIndex
CREATE INDEX "CommunicationAddress_language_idx" ON "CommunicationAddress"("language");

-- CreateIndex
CREATE INDEX "CommunicationAddress_consentStatus_idx" ON "CommunicationAddress"("consentStatus");

-- CreateIndex
CREATE INDEX "Company_companyEmailNorm_idx" ON "Company"("companyEmailNorm");

-- CreateIndex
CREATE INDEX "Company_customerStatus_idx" ON "Company"("customerStatus");

-- CreateIndex
CREATE INDEX "Company_industryId_idx" ON "Company"("industryId");

-- CreateIndex
CREATE INDEX "Company_classificationId_idx" ON "Company"("classificationId");

-- CreateIndex
CREATE INDEX "Company_archivedAt_idx" ON "Company"("archivedAt");

-- CreateIndex
CREATE INDEX "Company_syncedAt_idx" ON "Company"("syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_mondayBoardId_mondayItemId_key" ON "Company"("mondayBoardId", "mondayItemId");

-- CreateIndex
CREATE INDEX "Contact_emailNorm_idx" ON "Contact"("emailNorm");

-- CreateIndex
CREATE INDEX "Contact_archivedAt_idx" ON "Contact"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_mondayBoardId_mondayItemId_key" ON "Contact"("mondayBoardId", "mondayItemId");

-- CreateIndex
CREATE INDEX "CompanyContact_contactId_idx" ON "CompanyContact"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContact_companyId_contactId_key" ON "CompanyContact"("companyId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_mondayColumnId_mondayLabelIndex_key" ON "Industry"("mondayColumnId", "mondayLabelIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerClassification_mondayColumnId_mondayLabelIndex_key" ON "CustomerClassification"("mondayColumnId", "mondayLabelIndex");

-- CreateIndex
CREATE INDEX "Product_itemType_idx" ON "Product"("itemType");

-- CreateIndex
CREATE UNIQUE INDEX "Product_mondayBoardId_mondayItemId_key" ON "Product"("mondayBoardId", "mondayItemId");

-- CreateIndex
CREATE INDEX "CustomerProduct_companyId_idx" ON "CustomerProduct"("companyId");

-- CreateIndex
CREATE INDEX "CustomerProduct_contactId_idx" ON "CustomerProduct"("contactId");

-- CreateIndex
CREATE INDEX "CustomerProduct_productId_idx" ON "CustomerProduct"("productId");

-- CreateIndex
CREATE INDEX "CustomerProduct_subscriptionUntil_idx" ON "CustomerProduct"("subscriptionUntil");

-- CreateIndex
CREATE INDEX "CustomerProduct_status_idx" ON "CustomerProduct"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProduct_mondayBoardId_mondayItemId_key" ON "CustomerProduct"("mondayBoardId", "mondayItemId");

-- CreateIndex
CREATE INDEX "CompanyProduct_productId_idx" ON "CompanyProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProduct_companyId_productId_key" ON "CompanyProduct"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ContentItem_reviewState_idx" ON "ContentItem"("reviewState");

-- CreateIndex
CREATE INDEX "ContentItem_origin_idx" ON "ContentItem"("origin");

-- CreateIndex
CREATE INDEX "ContentItem_language_idx" ON "ContentItem"("language");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_idx" ON "ContentItem"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_sourceId_externalId_key" ON "ContentItem"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_scheduledAt_idx" ON "Campaign"("scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignContentItem_campaignId_position_idx" ON "CampaignContentItem"("campaignId", "position");

-- CreateIndex
CREATE INDEX "CampaignContentItem_contentItemId_idx" ON "CampaignContentItem"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContentItem_campaignId_contentItemId_key" ON "CampaignContentItem"("campaignId", "contentItemId");

-- CreateIndex
CREATE INDEX "ContentSource_kind_idx" ON "ContentSource"("kind");

-- CreateIndex
CREATE INDEX "ContentSource_isEnabled_idx" ON "ContentSource"("isEnabled");

-- CreateIndex
CREATE INDEX "ContentIngestionRun_sourceId_idx" ON "ContentIngestionRun"("sourceId");

-- CreateIndex
CREATE INDEX "ContentIngestionRun_status_idx" ON "ContentIngestionRun"("status");

-- CreateIndex
CREATE INDEX "NewsletterAutomation_isEnabled_idx" ON "NewsletterAutomation"("isEnabled");

-- CreateIndex
CREATE INDEX "NewsletterAutomation_nextScheduledAt_idx" ON "NewsletterAutomation"("nextScheduledAt");

-- CreateIndex
CREATE INDEX "NewsletterAutomation_segmentId_idx" ON "NewsletterAutomation"("segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterAutomationRun_generatedCampaignId_key" ON "NewsletterAutomationRun"("generatedCampaignId");

-- CreateIndex
CREATE INDEX "NewsletterAutomationRun_automationId_idx" ON "NewsletterAutomationRun"("automationId");

-- CreateIndex
CREATE INDEX "NewsletterAutomationRun_status_idx" ON "NewsletterAutomationRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterAutomationRun_automationId_scheduledFor_key" ON "NewsletterAutomationRun"("automationId", "scheduledFor");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_idx" ON "CampaignRecipient"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_normalizedEmail_idx" ON "CampaignRecipient"("normalizedEmail");

-- CreateIndex
CREATE INDEX "CampaignRecipient_state_idx" ON "CampaignRecipient"("state");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_normalizedEmail_key" ON "CampaignRecipient"("campaignId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "CampaignRecipientSource_companyId_idx" ON "CampaignRecipientSource"("companyId");

-- CreateIndex
CREATE INDEX "CampaignRecipientSource_contactId_idx" ON "CampaignRecipientSource"("contactId");

-- CreateIndex
CREATE INDEX "CampaignRecipientSource_sourceBoardId_sourceItemId_idx" ON "CampaignRecipientSource"("sourceBoardId", "sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipientSource_recipientId_sourceBoardId_sourceIte_key" ON "CampaignRecipientSource"("recipientId", "sourceBoardId", "sourceItemId", "emailSourceType");

-- CreateIndex
CREATE INDEX "CampaignAudienceSnapshot_campaignId_idx" ON "CampaignAudienceSnapshot"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignAudienceExclusion_campaignId_idx" ON "CampaignAudienceExclusion"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignAudienceExclusion_reason_idx" ON "CampaignAudienceExclusion"("reason");

-- CreateIndex
CREATE INDEX "CampaignTestSend_campaignId_idx" ON "CampaignTestSend"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_idx" ON "CampaignEvent"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignEvent_recipientId_idx" ON "CampaignEvent"("recipientId");

-- CreateIndex
CREATE INDEX "CampaignEvent_type_idx" ON "CampaignEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_providerEventId_key" ON "CampaignEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "Unsubscribe_normalizedEmail_idx" ON "Unsubscribe"("normalizedEmail");

-- CreateIndex
CREATE INDEX "Unsubscribe_communicationAddressId_idx" ON "Unsubscribe"("communicationAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "Unsubscribe_normalizedEmail_scope_key" ON "Unsubscribe"("normalizedEmail", "scope");

-- CreateIndex
CREATE INDEX "Suppression_normalizedEmail_idx" ON "Suppression"("normalizedEmail");

-- CreateIndex
CREATE INDEX "Suppression_communicationAddressId_idx" ON "Suppression"("communicationAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_normalizedEmail_reason_key" ON "Suppression"("normalizedEmail", "reason");

-- CreateIndex
CREATE INDEX "SuppressionEvent_normalizedEmail_idx" ON "SuppressionEvent"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEvent_providerEventId_key" ON "SuppressionEvent"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MondayBoard_mondayBoardId_key" ON "MondayBoard"("mondayBoardId");

-- CreateIndex
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "SyncItemLog_syncRunId_idx" ON "SyncItemLog"("syncRunId");

-- CreateIndex
CREATE INDEX "SyncItemLog_mondayItemId_idx" ON "SyncItemLog"("mondayItemId");

-- CreateIndex
CREATE INDEX "MondayWebhookEvent_itemId_idx" ON "MondayWebhookEvent"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MondayWebhookEvent_mondayEventId_key" ON "MondayWebhookEvent"("mondayEventId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "CustomerClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyContact" ADD CONSTRAINT "CompanyContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyContact" ADD CONSTRAINT "CompanyContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProduct" ADD CONSTRAINT "CompanyProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProduct" ADD CONSTRAINT "CompanyProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContentItem" ADD CONSTRAINT "CampaignContentItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContentItem" ADD CONSTRAINT "CampaignContentItem_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentIngestionRun" ADD CONSTRAINT "ContentIngestionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterAutomation" ADD CONSTRAINT "NewsletterAutomation_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterAutomationRun" ADD CONSTRAINT "NewsletterAutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "NewsletterAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterAutomationRun" ADD CONSTRAINT "NewsletterAutomationRun_generatedCampaignId_fkey" FOREIGN KEY ("generatedCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_communicationAddressId_fkey" FOREIGN KEY ("communicationAddressId") REFERENCES "CommunicationAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientSource" ADD CONSTRAINT "CampaignRecipientSource_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientSource" ADD CONSTRAINT "CampaignRecipientSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientSource" ADD CONSTRAINT "CampaignRecipientSource_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAudienceSnapshot" ADD CONSTRAINT "CampaignAudienceSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAudienceExclusion" ADD CONSTRAINT "CampaignAudienceExclusion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTestSend" ADD CONSTRAINT "CampaignTestSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unsubscribe" ADD CONSTRAINT "Unsubscribe_communicationAddressId_fkey" FOREIGN KEY ("communicationAddressId") REFERENCES "CommunicationAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_communicationAddressId_fkey" FOREIGN KEY ("communicationAddressId") REFERENCES "CommunicationAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_mondayBoardId_fkey" FOREIGN KEY ("mondayBoardId") REFERENCES "MondayBoard"("mondayBoardId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncItemLog" ADD CONSTRAINT "SyncItemLog_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
