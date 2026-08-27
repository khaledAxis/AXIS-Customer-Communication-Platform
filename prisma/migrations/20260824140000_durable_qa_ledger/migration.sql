-- CreateEnum
CREATE TYPE "QaRecordOrigin" AS ENUM ('LIVE', 'TEST_FIXTURE');

-- CreateEnum
CREATE TYPE "QaRunStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "QaSendState" AS ENUM ('SENDING', 'ACCEPTED', 'FAILED', 'UNCERTAIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'QA_RUN_OPENED';
ALTER TYPE "AuditAction" ADD VALUE 'QA_RUN_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'QA_LEDGER_RECOVERED';

-- CreateTable
CREATE TABLE "QaEmailRun" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "QaRunStatus" NOT NULL DEFAULT 'OPEN',
    "origin" "QaRecordOrigin" NOT NULL DEFAULT 'LIVE',
    "fixtureOwner" TEXT,
    "plannedCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaEmailRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEmailSend" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "origin" "QaRecordOrigin" NOT NULL DEFAULT 'LIVE',
    "fixtureOwner" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "state" "QaSendState" NOT NULL DEFAULT 'SENDING',
    "failureCode" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "ledgerRecovered" BOOLEAN NOT NULL DEFAULT false,
    "recoveryNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaEmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaEmailRun_status_idx" ON "QaEmailRun"("status");

-- CreateIndex
CREATE INDEX "QaEmailRun_origin_idx" ON "QaEmailRun"("origin");

-- CreateIndex
CREATE INDEX "QaEmailRun_fixtureOwner_idx" ON "QaEmailRun"("fixtureOwner");

-- CreateIndex
CREATE INDEX "QaEmailSend_runId_idx" ON "QaEmailSend"("runId");

-- CreateIndex
CREATE INDEX "QaEmailSend_recipient_idx" ON "QaEmailSend"("recipient");

-- CreateIndex
CREATE INDEX "QaEmailSend_origin_idx" ON "QaEmailSend"("origin");

-- CreateIndex
CREATE INDEX "QaEmailSend_fixtureOwner_idx" ON "QaEmailSend"("fixtureOwner");

-- CreateIndex
CREATE INDEX "QaEmailSend_state_idx" ON "QaEmailSend"("state");

-- CreateIndex
CREATE UNIQUE INDEX "QaEmailSend_providerMessageId_key" ON "QaEmailSend"("providerMessageId");

-- AddForeignKey
ALTER TABLE "QaEmailRun" ADD CONSTRAINT "QaEmailRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEmailSend" ADD CONSTRAINT "QaEmailSend_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaEmailRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEmailSend" ADD CONSTRAINT "QaEmailSend_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

