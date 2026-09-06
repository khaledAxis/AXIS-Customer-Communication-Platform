import "server-only";
import { createHmac } from "node:crypto";
import { consumeSharedAttempt, pruneExpiredAttempts, releaseSharedAttempt } from "../db/repositories/authRateLimitRepository";
import { consumeSignInAttempt, releaseSignInAttempt, MAX_ATTEMPTS, WINDOW_MS } from "./rateLimit";

let nextPrune = 0;
function keyFor(identity: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Hosted authentication is not configured.");
  return createHmac("sha256", secret).update(`login:${identity.toLowerCase()}`).digest("hex");
}

/** Local and desktop flows retain their existing throttle. Hosted failures never fall back. */
export async function consumeLoginAttempt(identity: string): Promise<boolean> {
  if (process.env.AXIS_HOSTED !== "true") return consumeSignInAttempt(identity);
  try {
    const allowed = await consumeSharedAttempt(keyFor(identity), MAX_ATTEMPTS, WINDOW_MS);
    if (Date.now() >= nextPrune) {
      nextPrune = Date.now() + WINDOW_MS;
      // Best-effort housekeeping cannot turn a denied attempt into an allowed one.
      await pruneExpiredAttempts().catch(() => undefined);
    }
    return allowed;
  } catch {
    return false;
  }
}

export async function releaseLoginAttempt(identity: string): Promise<void> {
  if (process.env.AXIS_HOSTED !== "true") return releaseSignInAttempt(identity);
  await releaseSharedAttempt(keyFor(identity));
}
