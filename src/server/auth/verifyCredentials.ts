import "server-only";

import { signInRefusal } from "../../domain/auth/authorization";
import { SignInInputError, parseSignIn } from "../../domain/auth/credentials";
import { getPrisma } from "../db/prisma";
import { verifyPassword } from "./password";
import { consumeSignInAttempt, releaseSignInAttempt } from "./rateLimit";
import { recordFailedSignIn, recordSuccessfulSignIn } from "./signInAudit";
import type { SignInFailureCause } from "./types";

/**
 * The one place a password is ever checked (ADR-0023).
 *
 * Deliberately separate from the Auth.js wiring in `config.ts`: this is the security
 * decision, and it is plain server code with no framework coupling — which means it
 * can be exercised directly by tests, exactly as it runs in production, rather than
 * through a simulated HTTP request.
 *
 * Order of operations, and why:
 *
 *  1. **Parse first.** A malformed submission never reaches the database.
 *  2. **Throttle second.** A login endpoint that runs Argon2 for every request is its
 *     own denial of service, so a refused attempt costs one map lookup.
 *  3. **Verify the password BEFORE the account-state checks.** A wrong password and a
 *     deactivated account then cost the same and look the same from outside; checking
 *     `isActive` first would let an attacker enumerate accounts by timing.
 *  4. **Return a cause, never a message.** The caller turns every failure into one
 *     generic sentence. The cause exists for the audit trail, which AXIS staff read.
 *
 * Nothing here logs a password, a hash, or any part of either.
 */

export type CredentialCheck =
  | { ok: true; userId: string; email: string }
  | { ok: false; cause: SignInFailureCause };

export async function verifyCredentials(raw: {
  email: unknown;
  password: unknown;
}): Promise<CredentialCheck> {
  let credentials;
  try {
    credentials = parseSignIn({ email: raw.email, password: raw.password });
  } catch (error) {
    if (error instanceof SignInInputError) {
      await recordFailedSignIn(null, "MALFORMED_INPUT");
      return { ok: false, cause: "MALFORMED_INPUT" };
    }
    throw error;
  }

  if (!consumeSignInAttempt(credentials.email)) {
    await recordFailedSignIn(credentials.email, "RATE_LIMITED");
    return { ok: false, cause: "RATE_LIMITED" };
  }

  const user = await getPrisma().user.findUnique({
    where: { email: credentials.email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      isActive: true,
      isSystemAccount: true,
    },
  });

  if (!user) {
    await recordFailedSignIn(credentials.email, "UNKNOWN_EMAIL");
    return { ok: false, cause: "UNKNOWN_EMAIL" };
  }

  const passwordOk = await verifyPassword(user.passwordHash, credentials.password);
  if (!passwordOk) {
    await recordFailedSignIn(credentials.email, "BAD_PASSWORD");
    return { ok: false, cause: "BAD_PASSWORD" };
  }

  // Only now does account state matter. A system account (the retired development
  // stand-in) is refused here as well as at the session layer.
  const refusal = signInRefusal(user);
  if (refusal) {
    await recordFailedSignIn(credentials.email, refusal);
    return { ok: false, cause: refusal };
  }

  releaseSignInAttempt(credentials.email);
  await recordSuccessfulSignIn(user.id, user.email);

  return { ok: true, userId: user.id, email: user.email };
}
