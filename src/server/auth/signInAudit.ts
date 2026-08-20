import "server-only";

import { getPrisma } from "../db/prisma";
import type { SignInFailureCause } from "./types";

/**
 * Audit trail for authentication events (ADR-0023).
 *
 * What is recorded: who, when, and — for a failure — why, using a coarse cause code.
 * What is NEVER recorded: the password, any hash, any session token, or any part of
 * them. The metadata below is constructed field by field for exactly that reason;
 * there is no path that spreads a credentials object into it.
 *
 * Auditing runs on a best-effort basis: a failure to write an audit row must not turn
 * a legitimate sign-in into an error, and must not turn a rejected sign-in into a
 * successful one. Both paths therefore swallow their own errors.
 */

export async function recordSuccessfulSignIn(
  userId: string,
  email: string,
): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          action: "USER_SIGNED_IN",
          actorUserId: userId,
          entityType: "User",
          entityId: userId,
          toState: "SIGNED_IN",
          metadata: { email },
        },
      }),
    ]);
  } catch {
    // Never block a valid sign-in on bookkeeping.
  }
}

export async function recordFailedSignIn(
  email: string | null,
  cause: SignInFailureCause,
): Promise<void> {
  try {
    await getPrisma().auditLog.create({
      data: {
        action: "USER_SIGN_IN_FAILED",
        // No actor: a failed attempt has not proven who it is.
        actorUserId: null,
        entityType: "User",
        entityId: null,
        toState: "REJECTED",
        // The cause is for AXIS staff reading the trail. The browser is told only
        // the generic failure message, so this never leaks account existence.
        metadata: email ? { email, cause } : { cause },
      },
    });
  } catch {
    // A rejected sign-in stays rejected whether or not it could be recorded.
  }
}
