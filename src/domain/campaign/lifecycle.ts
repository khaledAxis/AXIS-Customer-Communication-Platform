export const CAMPAIGN_TRANSITIONS = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  REJECTED: ["DRAFT"],
  APPROVED: ["SCHEDULED", "SENDING", "DRAFT"],
  SCHEDULED: ["SENDING", "DRAFT", "CANCELED"],
  SENDING: ["SENT", "FAILED"],
  SENT: [], FAILED: [], CANCELED: [],
} as const;
export type CampaignState = keyof typeof CAMPAIGN_TRANSITIONS;
export function assertCampaignTransition(from: CampaignState, to: CampaignState) {
  if (!(CAMPAIGN_TRANSITIONS[from] as readonly string[]).includes(to))
    throw new Error(`A newsletter cannot move from ${from} to ${to}.`);
}
