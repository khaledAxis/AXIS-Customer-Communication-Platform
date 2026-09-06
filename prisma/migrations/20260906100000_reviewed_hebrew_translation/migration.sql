CREATE TYPE "ContentTranslationState" AS ENUM ('RUNNING', 'READY', 'FAILED');
CREATE TABLE "ContentTranslation" (
  "id" TEXT NOT NULL,
  "sourceContentItemId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "targetLanguage" "Language" NOT NULL DEFAULT 'HE',
  "state" "ContentTranslationState" NOT NULL DEFAULT 'RUNNING',
  "requestedById" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "errorCode" TEXT,
  "generatedContentItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentTranslation_hebrew_target" CHECK ("targetLanguage" = 'HE'),
  CONSTRAINT "ContentTranslation_distinct_source" CHECK ("generatedContentItemId" IS NULL OR "generatedContentItemId" <> "sourceContentItemId"),
  CONSTRAINT "ContentTranslation_sourceContentItemId_fkey" FOREIGN KEY ("sourceContentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContentTranslation_generatedContentItemId_fkey" FOREIGN KEY ("generatedContentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContentTranslation_generatedContentItemId_key" ON "ContentTranslation"("generatedContentItemId");
CREATE INDEX "ContentTranslation_sourceContentItemId_sourceHash_createdAt_idx" ON "ContentTranslation"("sourceContentItemId", "sourceHash", "createdAt");
CREATE INDEX "ContentTranslation_state_createdAt_idx" ON "ContentTranslation"("state", "createdAt");
CREATE INDEX "ContentTranslation_requestedById_createdAt_idx" ON "ContentTranslation"("requestedById", "createdAt");
