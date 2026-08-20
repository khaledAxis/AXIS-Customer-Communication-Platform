import "server-only";

import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Password hashing (ADR-0023).
 *
 * **Argon2id**, via `@node-rs/argon2` — prebuilt native bindings, so there is no
 * compiler toolchain requirement on Windows or in a container. Argon2id is the
 * memory-hard, side-channel-resistant variant recommended for password storage; the
 * cost parameters below are the OWASP baseline (19 MiB, 2 iterations, 1 lane).
 *
 * Rules this module exists to make structural:
 *
 *  - a plaintext password is never stored, never returned, and never logged;
 *  - a hash is one-way — there is no `decrypt`, and there never will be;
 *  - verification is constant-time inside Argon2 itself, so a wrong password costs
 *    the same as a right one;
 *  - `verifyPassword` swallows malformed-hash errors and returns `false`, so a
 *    corrupted or legacy non-Argon2 value can never be treated as a match.
 *
 * `server-only` makes importing this from a client component a build error.
 */

/**
 * `Algorithm.Argon2id`. The binding declares `Algorithm` as an ambient `const enum`,
 * which `isolatedModules` cannot read at runtime, so the value is written out and
 * pinned by the assertion below — a change to the binding's numbering becomes a
 * compile error rather than a silently different algorithm.
 */
const ARGON2ID = 2 satisfies Algorithm;

/** OWASP baseline for Argon2id. Raising these later re-hashes on next sign-in. */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const;

/** Marks a stored value that can never authenticate (see `UNUSABLE_PASSWORD_HASH`). */
const UNUSABLE_PREFIX = "!";

/**
 * A value that is deliberately not a valid hash. Used for accounts that must exist
 * for historical references but must never sign in. `verifyPassword` refuses it
 * before doing any work.
 */
export const UNUSABLE_PASSWORD_HASH = `${UNUSABLE_PREFIX}no-login`;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns a boolean and never throws: an unreadable stored value is a failed login,
 * not a 500 that tells an attacker something interesting.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  plaintext: string,
): Promise<boolean> {
  if (!storedHash || storedHash.startsWith(UNUSABLE_PREFIX)) return false;
  if (!storedHash.startsWith("$argon2")) return false;
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/** True when a stored value could never authenticate. */
export function isUnusableHash(storedHash: string | null | undefined): boolean {
  return (
    !storedHash ||
    storedHash.startsWith(UNUSABLE_PREFIX) ||
    !storedHash.startsWith("$argon2")
  );
}
