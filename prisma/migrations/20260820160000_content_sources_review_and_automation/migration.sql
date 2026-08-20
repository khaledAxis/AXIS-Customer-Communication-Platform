-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_SOURCE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_SOURCE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_SOURCE_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_SOURCE_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_INGESTION_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'NEWSLETTER_DRAFT_CREATED_FROM_CONTENT';
ALTER TYPE "AuditAction" ADD VALUE 'AUTOMATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTOMATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTOMATION_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTOMATION_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTOMATION_RUN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AutomationRunStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "AutomationRunStatus" ADD VALUE 'NO_CONTENT';

-- AlterEnum
ALTER TYPE "ContentSourceKind" ADD VALUE 'ATOM';

-- AlterTable
ALTER TABLE "ContentIngestionRun" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "triggeredById" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "axisHeadline" TEXT,
ADD COLUMN     "axisSummary" TEXT,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "ctaUrl" TEXT,
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "normalizedUrl" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "ContentSource" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "feedUrl" TEXT,
ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorMessage" TEXT,
ADD COLUMN     "lastSucceededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NewsletterAutomation" ADD COLUMN     "category" TEXT,
ADD COLUMN     "maxItems" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "NewsletterAutomationRun" ADD COLUMN     "itemsFound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemsNew" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourcesFailed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "NewsletterAutomationSource" (
    "automationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterAutomationSource_pkey" PRIMARY KEY ("automationId","sourceId")
);

-- CreateIndex
CREATE INDEX "NewsletterAutomationSource_sourceId_idx" ON "NewsletterAutomationSource"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_sourceId_normalizedUrl_key" ON "ContentItem"("sourceId", "normalizedUrl");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSource" ADD CONSTRAINT "ContentSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterAutomationSource" ADD CONSTRAINT "NewsletterAutomationSource_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "NewsletterAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterAutomationSource" ADD CONSTRAINT "NewsletterAutomationSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

