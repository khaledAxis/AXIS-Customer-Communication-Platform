import "server-only";

/**
 * In-process throttle for sign-in attempts (ADR-0023).
 *
 * A login endpoint that runs Argon2 for every request is a denial-of-service target,
 * and an un-throttled one is an offline-speed password guesser. This bounds both.
 *
 * KNOWN LIMITATIONS, stated rather than hidden:
 *
 *  - state lives in this process, so it resets on restart and is not shared across
 *    instances. The platform runs as a single internal server today (ADR-0005 defers
 *    Redis until a milestone proves the need), so a shared store would be
 *    infrastructure bought before it is needed.
 *  - it is keyed by the submitted EMAIL, not the client IP. That protects an account
 *    from being ground down, which is the threat here; it does not stop a spray
 *    across many accounts from one machine. An IP-keyed limit belongs with a reverse
 *    proxy, not in application code.
 *
 * Nothing here is a substitute for a strong password policy — it buys time, not
 * safety.
 */

/** Attempts allowed inside one window before an identity is refused. */
export const MAX_ATTEMPTS = 8;

/** How long the window lasts, and how long a lockout persists. */
export const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  /** When the current window opened. */
  startedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Bound on the map, so a spray across invented addresses cannot grow it forever. */
const MAX_TRACKED_IDENTITIES = 5_000;

function now(): number {
  return Date.now();
}

function prune(reference: number): void {
  if (buckets.size <= MAX_TRACKED_IDENTITIES) return;
  for (const [key, bucket] of buckets) {
    if (reference - bucket.startedAt > WINDOW_MS) buckets.delete(key);
    if (buckets.size <= MAX_TRACKED_IDENTITIES) return;
  }
}

/**
 * Records an attempt. Returns false when the identity is currently throttled.
 *
 * Called BEFORE the database lookup and before hashing, so a refused attempt costs
 * almost nothing.
 */
export function consumeSignInAttempt(identity: string, at: number = now()): boolean {
  const key = identity.toLowerCase();
  const bucket = buckets.get(key);

  if (!bucket || at - bucket.startedAt > WINDOW_MS) {
    buckets.set(key, { count: 1, startedAt: at });
    prune(at);
    return true;
  }

  bucket.count += 1;
  return bucket.count <= MAX_ATTEMPTS;
}

/** Clears the counter after a successful sign-in. */
export function releaseSignInAttempt(identity: string): void {
  buckets.delete(identity.toLowerCase());
}

/** Test seam. Never called by application code. */
export function resetSignInThrottle(): void {
  buckets.clear();
}

// ---------------------------------------------------------------------------
// Public unsubscribe probes (ADR-0024)
// ---------------------------------------------------------------------------

/**
 * Invalid unsubscribe attempts allowed per client, per window.
 *
 * Generous on purpose. This throttle exists to make brute-forcing a 256-bit token
 * pointless (it already is) and to blunt scanning — NOT to stand between a recipient
 * and the unsubscribe link they were sent. A VALID token is never counted here, so a
 * genuine recipient cannot be locked out no matter how busy the endpoint is.
 */
export const MAX_UNSUBSCRIBE_PROBES = 30;

const probes = new Map<string, Bucket>();

/**
 * Records an INVALID unsubscribe attempt. Returns false once the client has spent its
 * allowance.
 *
 * `clientKey` is a best-effort identifier taken from proxy headers. It is spoofable,
 * which is why it bounds abuse rather than authorising anything — the token is the
 * only thing that authorises.
 */
export function consumeUnsubscribeProbe(
  clientKey: string,
  at: number = now(),
): boolean {
  const key = clientKey.toLowerCase();
  const bucket = probes.get(key);

  if (!bucket || at - bucket.startedAt > WINDOW_MS) {
    probes.set(key, { count: 1, startedAt: at });
    if (probes.size > MAX_TRACKED_IDENTITIES) {
      for (const [existing, value] of probes) {
        if (at - value.startedAt > WINDOW_MS) probes.delete(existing);
        if (probes.size <= MAX_TRACKED_IDENTITIES) break;
      }
    }
    return true;
  }

  bucket.count += 1;
  return bucket.count <= MAX_UNSUBSCRIBE_PROBES;
}

/** Test seam. Never called by application code. */
export function resetUnsubscribeProbes(): void {
  probes.clear();
}
