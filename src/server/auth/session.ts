import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import {
  Capability,
  NotAuthenticatedError,
  NotAuthorizedError,
  PasswordChangeRequiredError,
  assertCan,
  can,
  type Actor,
  type Role,
} from "../../domain/auth/authorization";
import { getPrisma } from "../db/prisma";

/**
 * The Data Access Layer for identity (ADR-0023, and the pattern the Next.js
 * authentication guide recommends).
 *
 * This is THE place the application learns who is acting. Two properties matter:
 *
 *  1. **The row is re-read, not trusted from the token.** The session cookie carries
 *     only a user id. Role, active state and system-account status come from the
 *     database on every request, so deactivating someone or changing their role takes
 *     effect on their next click rather than whenever their token happens to expire.
 *
 *  2. **It is memoised per request** with React `cache()`, so a page that asks five
 *     times costs one query. `cache()` is scoped to a single render — it cannot leak
 *     one person's identity into another person's request.
 *
 * Every protected page and every mutating server action calls one of these. Proxy
 * (`src/proxy.ts`) redirects unauthenticated traffic early, but it is a convenience,
 * not the guard: the guard is here, next to the data.
 */

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Integration tests exercise services directly — no HTTP request, so no session
 * cookie. This lets a suite state who is acting, exactly as `setCrmSourceForTesting`
 * lets one state which CRM answers.
 *
 * Two things keep a convenient seam from becoming an authentication bypass:
 * it throws when called outside a test runner, and the real request path below never
 * consults it.
 */
let testActor: Actor | null | undefined;

function inTestRunner(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

export function setActorForTesting(actor: Actor | null | undefined): void {
  if (!inTestRunner()) {
    throw new Error(
      "setActorForTesting is available only under the test runner. The signed-in " +
        "user is the only source of identity in a running application.",
    );
  }
  testActor = actor;
}

// ---------------------------------------------------------------------------
// Reading the actor
// ---------------------------------------------------------------------------

/**
 * Loads the session's user row.
 *
 * `cache()` memoises this for the duration of ONE render pass, so a page that asks
 * five times costs one query. It is not a cross-request cache and cannot be — which
 * is exactly why deactivating someone takes effect on their next request.
 */
const loadSessionActor = cache(async (): Promise<Actor | null> => {
  // Imported lazily so the Auth.js adapter is pulled in only when a real session has
  // to be read. Everything that depends on identity can then be exercised — in a test
  // or from a script — without dragging the whole HTTP-bound auth stack behind it.
  const { auth } = await import("./config");
  const session = await auth();
  const userId = session?.user?.id;
  if (typeof userId !== "string" || userId === "") return null;

  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    // `passwordHash` is deliberately absent: the actor object is passed around the
    // server and into props, and a hash must never be able to travel with it.
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      isSystemAccount: true,
      mustChangePassword: true,
    },
  });
  if (!user) return null;

  // A token can outlive the account it names. Deactivated and system accounts are
  // refused here, so a still-valid cookie grants nothing.
  if (!user.isActive || user.isSystemAccount) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    isActive: user.isActive,
    isSystemAccount: user.isSystemAccount,
    mustChangePassword: user.mustChangePassword,
  };
});

/** The signed-in actor, or null. Never throws — for pages that adapt to both. */
export async function getCurrentActor(): Promise<Actor | null> {
  // Under the test runner there is no HTTP request and therefore no session cookie,
  // so the seam is the ONLY source of identity: unset means nobody is signed in.
  // Falling through to the cookie path here would not find a session anyway.
  if (inTestRunner()) return testActor ?? null;
  return loadSessionActor();
}

/** Whether the current actor still has an administrator-issued password to replace. */
export async function currentActorMustChangePassword(): Promise<boolean> {
  const actor = await getCurrentActor();
  return actor?.mustChangePassword ?? false;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * For PAGES: redirects to the login screen when nobody is signed in.
 *
 * `redirect()` throws a control-flow signal, so nothing after this call runs for an
 * anonymous visitor.
 */
export async function requirePage(returnTo?: string): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  // An administrator-issued password is a secret two people know. The only page it
  // opens is the one that replaces it (ADR-0024).
  if (actor.mustChangePassword) redirect("/change-password");
  return actor;
}

/**
 * For the password-change page ITSELF, which must be reachable by exactly the people
 * `requirePage` sends there. Signed in, active — and nothing else required.
 */
export async function requireSignedIn(returnTo?: string): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return actor;
}

/** For PAGES: signed in AND allowed. An unauthorized visitor is sent to the start. */
export async function requirePageCapability(
  capability: Capability,
  returnTo?: string,
): Promise<Actor> {
  const actor = await requirePage(returnTo);
  if (!can(actor, capability)) redirect("/?denied=1");
  return actor;
}

/**
 * For SERVER ACTIONS and ROUTE HANDLERS: throws rather than redirects.
 *
 * Actions must fail loudly; a redirect inside an action would look like success to
 * calling code.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new NotAuthenticatedError();
  return actor;
}

/** The standard gate for a mutation: signed in, active, and holding the capability. */
export async function requireCapability(capability: Capability): Promise<Actor> {
  const actor = await getCurrentActor();
  return assertCan(actor, capability);
}

export {
  Capability,
  NotAuthenticatedError,
  NotAuthorizedError,
  PasswordChangeRequiredError,
};
export type { Actor };
