-- Reply-To + sender display name recorded on the SAFE TEST approval and attempt (ADR-0019).
-- Nullable: rows created before this migration have no recorded reply address, and
-- checkApproval() treats such an approval as invalid rather than assuming a value.
ALTER TABLE "CampaignTestApproval" ADD COLUMN "replyToEmail" TEXT;
ALTER TABLE "CampaignTestApproval" ADD COLUMN "senderName" TEXT;
ALTER TABLE "CampaignTestSend" ADD COLUMN "replyToEmail" TEXT;
ALTER TABLE "CampaignTestSend" ADD COLUMN "senderName" TEXT;
