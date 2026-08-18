-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "preheader" TEXT,
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageUrl" TEXT;
