import { randomUUID } from "node:crypto";

import type { Actor, Role } from "../../src/domain/auth/authorization";
import { setActorForTesting } from "../../src/server/auth/session";
import { getPrisma } from "../../src/server/db/prisma";
import { UNUSABLE_PASSWORD_HASH } from "../../src/server/auth/password";

/**
 * Signing in, for integration suites.
 *
 * Services derive their actor from the session (ADR-0023), and a test has no HTTP
 * request to carry one. `setActorForTesting` is the seam for that — it refuses to run
 * outside the test runner, so it cannot become an authentication bypass in a real
 * deployment.
 *
 * Suites create REAL `User` rows, because foreign keys point at them and because a
 * four-eyes test is only meaningful between two rows that actually exist. Passwords
 * are never set here: these users are never signed in through the credentials path,
 * so they carry the deliberately-unusable hash.
 */

export interface TestUser extends Actor {
  id: string;
}

/** Creates a staff account for a suite and returns it as an actor. */
export async function createTestUser(options: {
  /** Run-scoped prefix, so parallel suites never collide. */
  prefix: string;
  role: Role;
  name?: string;
}): Promise<TestUser> {
  const email = `${options.prefix}-${randomUUID().slice(0, 8)}@axis-test.invalid`;
  const user = await getPrisma().user.create({
    data: {
      email,
      name: options.name ?? `Test ${options.role}`,
      role: options.role,
      // Never a real credential: these users exist to be referenced, not to log in.
      passwordHash: UNUSABLE_PASSWORD_HASH,
      isActive: true,
    },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    isActive: user.isActive,
    isSystemAccount: false,
    mustChangePassword: false,
  };
}

/** Makes subsequent service calls run as this person. */
export function actAs(actor: Actor | null): void {
  setActorForTesting(actor);
}

/** Returns to "nobody is signed in", so a suite can assert a refusal. */
export function actAsNobody(): void {
  setActorForTesting(null);
}

/**
 * Clears the override entirely, restoring the real session lookup. Call in `afterAll`
 * so one suite's actor can never leak into another.
 */
export function clearTestActor(): void {
  setActorForTesting(undefined);
}
