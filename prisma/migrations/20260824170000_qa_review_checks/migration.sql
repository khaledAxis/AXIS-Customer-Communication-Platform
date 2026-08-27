-- CreateEnum
CREATE TYPE "QaCheckStatus" AS ENUM ('NOT_CHECKED', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "QaDefectSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'COSMETIC');

-- CreateTable
CREATE TABLE "QaReviewCheck" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "QaCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "severity" "QaDefectSeverity",
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaReviewCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaReviewCheck_status_idx" ON "QaReviewCheck"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QaReviewCheck_sendId_checkKey_key" ON "QaReviewCheck"("sendId", "checkKey");

-- AddForeignKey
ALTER TABLE "QaReviewCheck" ADD CONSTRAINT "QaReviewCheck_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "QaEmailSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReviewCheck" ADD CONSTRAINT "QaReviewCheck_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

