-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "publicPageEnabledAt" TIMESTAMP(3),
ADD COLUMN     "publicPageEnabledById" TEXT,
ADD COLUMN     "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_publicToken_key" ON "Campaign"("publicToken");

