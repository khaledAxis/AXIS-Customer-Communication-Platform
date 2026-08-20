-- Public unsubscribe + production delivery ledger foundation (ADR-0024).
--
-- `CampaignRecipient.finalAudienceId` is added as NOT NULL with no default. That is
-- safe here and deliberate: the table is empty (no production delivery has ever been
-- prepared), and a recipient without a frozen-audience provenance is a recipient
-- nobody approved. Making it nullable "just in case" would leave exactly that hole.

-- CreateEnum
CREATE TYPE "UnsubscribeTokenPurpose" AS ENUM ('PRODUCTION', 'FIXTURE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DELIVERY_LEDGER_PREPARED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_EVENT_INGESTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignRecipientState" ADD VALUE 'ACCEPTED';
ALTER TYPE "CampaignRecipientState" ADD VALUE 'DELIVERED';
ALTER TYPE "CampaignRecipientState" ADD VALUE 'BOUNCED';
ALTER TYPE "CampaignRecipientState" ADD VALUE 'COMPLAINED';
ALTER TYPE "CampaignRecipientState" ADD VALUE 'UNCERTAIN';
ALTER TYPE "CampaignRecipientState" ADD VALUE 'SUPPRESSED';

-- AlterEnum
ALTER TYPE "EmailProviderKind" ADD VALUE 'PRODUCTION_DISABLED';

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "consentAtPreparation" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "finalAudienceId" TEXT NOT NULL,
ADD COLUMN     "languageAtPreparation" "Language" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "preparedById" TEXT,
ADD COLUMN     "vetoReason" "ExclusionReason";

-- CreateTable
CREATE TABLE "UnsubscribeToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "communicationAddressId" TEXT,
    "campaignId" TEXT,
    "purpose" "UnsubscribeTokenPurpose" NOT NULL DEFAULT 'PRODUCTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UnsubscribeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnsubscribeToken_tokenHash_key" ON "UnsubscribeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UnsubscribeToken_normalizedEmail_idx" ON "UnsubscribeToken"("normalizedEmail");

-- CreateIndex
CREATE INDEX "UnsubscribeToken_campaignId_idx" ON "UnsubscribeToken"("campaignId");

-- CreateIndex
CREATE INDEX "UnsubscribeToken_purpose_idx" ON "UnsubscribeToken"("purpose");

-- CreateIndex
CREATE INDEX "CampaignRecipient_finalAudienceId_idx" ON "CampaignRecipient"("finalAudienceId");

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_finalAudienceId_fkey" FOREIGN KEY ("finalAudienceId") REFERENCES "CampaignFinalAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

