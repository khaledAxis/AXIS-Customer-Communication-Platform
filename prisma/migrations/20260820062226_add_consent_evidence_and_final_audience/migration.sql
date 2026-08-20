-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('EXISTING_CUSTOMER_RELATIONSHIP', 'EXPLICIT_CUSTOMER_PERMISSION', 'IMPORTED_DOCUMENTED_PERMISSION', 'OTHER_DOCUMENTED_BASIS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CONSENT_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'FINAL_AUDIENCE_PREPARED';
ALTER TYPE "AuditAction" ADD VALUE 'PRODUCTION_APPROVAL_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'PRODUCTION_APPROVAL_REVOKED';

-- AlterEnum
ALTER TYPE "ExclusionReason" ADD VALUE 'CONSENT_NOT_CONFIRMED';

-- AlterTable
ALTER TABLE "CommunicationAddress" ADD COLUMN     "consentBatchId" TEXT,
ADD COLUMN     "consentEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "consentNote" TEXT,
ADD COLUMN     "consentRecordedAt" TIMESTAMP(3),
ADD COLUMN     "consentRecordedById" TEXT,
ADD COLUMN     "consentSource" "ConsentSource";

-- CreateTable
CREATE TABLE "CampaignFinalAudience" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "segmentId" TEXT,
    "segmentName" TEXT NOT NULL,
    "segmentCriteria" JSONB NOT NULL,
    "campaignLanguage" "Language" NOT NULL,
    "requireLanguage" "Language",
    "requireExplicitConsent" BOOLEAN NOT NULL DEFAULT false,
    "matchedCompanies" INTEGER NOT NULL,
    "matchedContacts" INTEGER NOT NULL,
    "matchedRecords" INTEGER NOT NULL,
    "withCandidateEmail" INTEGER NOT NULL,
    "eligible" INTEGER NOT NULL,
    "uniqueDestinations" INTEGER NOT NULL,
    "excluded" INTEGER NOT NULL,
    "duplicateSourcesCollapsed" INTEGER NOT NULL,
    "consentGranted" INTEGER NOT NULL DEFAULT 0,
    "consentNotConfirmed" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "audienceHash" TEXT NOT NULL,
    "crmLastSyncedAt" TIMESTAMP(3),
    "crmSyncRunId" TEXT,
    "destinationsTruncated" BOOLEAN NOT NULL DEFAULT false,
    "exclusionsTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFinalAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignFinalAudienceDestination" (
    "id" TEXT NOT NULL,
    "finalAudienceId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "intendedEmail" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "consentStatus" "ConsentStatus" NOT NULL,
    "emailStatus" "EmailStatus" NOT NULL,
    "sources" JSONB NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFinalAudienceDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignFinalAudienceExclusion" (
    "id" TEXT NOT NULL,
    "finalAudienceId" TEXT NOT NULL,
    "sourceBoardId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceEntityType" "CrmBoardKind" NOT NULL,
    "emailSourceType" "EmailSourceType" NOT NULL,
    "sourceEmailRaw" TEXT,
    "normalizedEmail" TEXT,
    "reason" "ExclusionReason" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFinalAudienceExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignProductionApproval" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "finalAudienceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "audienceHash" TEXT NOT NULL,
    "subjectSnapshot" TEXT NOT NULL,
    "preheaderSnapshot" TEXT,
    "campaignLanguage" "Language" NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "replyToEmail" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authenticatedActor" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignProductionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignFinalAudience_campaignId_createdAt_idx" ON "CampaignFinalAudience"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignFinalAudience_audienceHash_idx" ON "CampaignFinalAudience"("audienceHash");

-- CreateIndex
CREATE INDEX "CampaignFinalAudienceDestination_finalAudienceId_idx" ON "CampaignFinalAudienceDestination"("finalAudienceId");

-- CreateIndex
CREATE INDEX "CampaignFinalAudienceDestination_normalizedEmail_idx" ON "CampaignFinalAudienceDestination"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFinalAudienceDestination_finalAudienceId_normalized_key" ON "CampaignFinalAudienceDestination"("finalAudienceId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "CampaignFinalAudienceExclusion_finalAudienceId_idx" ON "CampaignFinalAudienceExclusion"("finalAudienceId");

-- CreateIndex
CREATE INDEX "CampaignFinalAudienceExclusion_finalAudienceId_reason_idx" ON "CampaignFinalAudienceExclusion"("finalAudienceId", "reason");

-- CreateIndex
CREATE INDEX "CampaignProductionApproval_campaignId_idx" ON "CampaignProductionApproval"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignProductionApproval_contentHash_idx" ON "CampaignProductionApproval"("contentHash");

-- CreateIndex
CREATE INDEX "CampaignProductionApproval_revokedAt_idx" ON "CampaignProductionApproval"("revokedAt");

-- CreateIndex
CREATE INDEX "CommunicationAddress_consentBatchId_idx" ON "CommunicationAddress"("consentBatchId");

-- AddForeignKey
ALTER TABLE "CampaignFinalAudience" ADD CONSTRAINT "CampaignFinalAudience_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFinalAudienceDestination" ADD CONSTRAINT "CampaignFinalAudienceDestination_finalAudienceId_fkey" FOREIGN KEY ("finalAudienceId") REFERENCES "CampaignFinalAudience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFinalAudienceExclusion" ADD CONSTRAINT "CampaignFinalAudienceExclusion_finalAudienceId_fkey" FOREIGN KEY ("finalAudienceId") REFERENCES "CampaignFinalAudience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProductionApproval" ADD CONSTRAINT "CampaignProductionApproval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProductionApproval" ADD CONSTRAINT "CampaignProductionApproval_finalAudienceId_fkey" FOREIGN KEY ("finalAudienceId") REFERENCES "CampaignFinalAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProductionApproval" ADD CONSTRAINT "CampaignProductionApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
