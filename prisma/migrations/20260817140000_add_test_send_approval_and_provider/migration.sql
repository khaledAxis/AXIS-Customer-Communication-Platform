-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('MICROSOFT_GRAPH', 'FAKE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TEST_SEND_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'TEST_SEND_ATTEMPTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TestSendState" ADD VALUE 'SENDING';
ALTER TYPE "TestSendState" ADD VALUE 'ACCEPTED';
ALTER TYPE "TestSendState" ADD VALUE 'UNCERTAIN';

-- AlterTable
ALTER TABLE "CampaignTestSend" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "approvalId" TEXT,
ADD COLUMN     "attemptedAt" TIMESTAMP(3),
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "provider" "EmailProviderKind",
ADD COLUMN     "providerStatusCode" INTEGER;

-- CreateTable
CREATE TABLE "CampaignTestApproval" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "subjectSnapshot" TEXT NOT NULL,
    "preheaderSnapshot" TEXT,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "sendMode" "SendMode" NOT NULL DEFAULT 'TEST',
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTestApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignTestApproval_campaignId_idx" ON "CampaignTestApproval"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignTestApproval_contentHash_idx" ON "CampaignTestApproval"("contentHash");

-- CreateIndex
CREATE INDEX "CampaignTestApproval_consumedAt_idx" ON "CampaignTestApproval"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTestSend_approvalId_key" ON "CampaignTestSend"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTestSend_idempotencyKey_key" ON "CampaignTestSend"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CampaignTestSend_state_idx" ON "CampaignTestSend"("state");

-- AddForeignKey
ALTER TABLE "CampaignTestSend" ADD CONSTRAINT "CampaignTestSend_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "CampaignTestApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTestApproval" ADD CONSTRAINT "CampaignTestApproval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTestApproval" ADD CONSTRAINT "CampaignTestApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

