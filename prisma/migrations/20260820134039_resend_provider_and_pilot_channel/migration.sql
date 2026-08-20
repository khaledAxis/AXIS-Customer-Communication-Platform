-- CreateEnum
CREATE TYPE "SendChannel" AS ENUM ('SAFE_TEST_GMAIL', 'PROVIDER_PILOT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_DOMAIN_CHECKED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_PILOT_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_PILOT_ATTEMPTED';
ALTER TYPE "AuditAction" ADD VALUE 'WEBHOOK_REJECTED';

-- AlterEnum
ALTER TYPE "EmailProviderKind" ADD VALUE 'RESEND';

-- AlterTable
ALTER TABLE "CampaignTestApproval" ADD COLUMN     "channel" "SendChannel" NOT NULL DEFAULT 'SAFE_TEST_GMAIL';

-- AlterTable
ALTER TABLE "CampaignTestSend" ADD COLUMN     "channel" "SendChannel" NOT NULL DEFAULT 'SAFE_TEST_GMAIL';

-- CreateTable
CREATE TABLE "ProviderDomainSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "spf" TEXT NOT NULL,
    "dkim" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,

    CONSTRAINT "ProviderDomainSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderDomainSnapshot_checkedAt_idx" ON "ProviderDomainSnapshot"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDomainSnapshot_provider_domain_key" ON "ProviderDomainSnapshot"("provider", "domain");

