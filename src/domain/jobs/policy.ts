import { Capability } from "../auth/authorization";

export const JOB_CAPABILITIES = {
  CRM_SYNC: [Capability.RUN_CRM_SYNC],
  AUTOMATION: [Capability.MANAGE_NEWSLETTERS, Capability.MANAGE_CONTENT],
  DISPATCH: [Capability.APPROVE_PRODUCTION, Capability.MANAGE_NEWSLETTERS, Capability.VIEW_CRM],
} as const;
export type JobKind = keyof typeof JOB_CAPABILITIES;
export const JOB_LEASE_MS = 120000;
export const JOB_MAX_ATTEMPTS = 3;
export function jobMayUse(kind: JobKind, capability: Capability): boolean {
  return (JOB_CAPABILITIES[kind] as readonly Capability[]).includes(capability);
}
export function retryDelayMs(attempt: number): number {
  return Math.min(60000 * 2 ** Math.max(0, attempt - 1), 900000);
}
export function deliveryConfirmation(count: number): string {
  return `SEND ${count} CUSTOMERS`;
}
