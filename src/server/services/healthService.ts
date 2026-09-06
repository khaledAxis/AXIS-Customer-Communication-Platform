import "server-only";
import { databaseIsReady } from "../db/repositories/healthRepository";
import { getPrisma } from "../db/prisma";

let inFlight: Promise<boolean> | undefined;
let last: { ready: boolean; until: number } | undefined;

/** Coalesced and briefly cached: arbitrary probe traffic cannot create a query queue. */
export async function isApplicationReady(): Promise<boolean> {
  // Database migrations alone cannot prove that the running generated client matches.
  // This validates/refreshes its cache without connecting the business pool.
  try { getPrisma(); } catch { return false; }
  if (last && last.until > Date.now()) return last.ready;
  if (inFlight) return inFlight;
  inFlight = databaseIsReady().catch(() => false).then(ready => {
    last = { ready, until: Date.now() + 1000 };
    return ready;
  }).finally(() => { inFlight = undefined; });
  return inFlight;
}
