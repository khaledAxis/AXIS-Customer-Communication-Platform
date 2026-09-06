import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/** Internal context carries a claimed row, never an arbitrary actor or a browser field. */
const context = new AsyncLocalStorage<{ jobId: string; leaseToken: string }>();
export const currentJob = () => context.getStore();
export function withinClaimedJob<T>(jobId: string, leaseToken: string, work: () => Promise<T>) {
  return context.run({ jobId, leaseToken }, work);
}
