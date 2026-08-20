import "server-only";

import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { verifyCredentials } from "./verifyCredentials";
import {
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_RATE_LIMITED_MESSAGE,
} from "./types";

/**
 * Auth.js (NextAuth v5) wiring for AXIS staff (ADR-0003, implemented in ADR-0023).
 *
 * This module is deliberately thin: the security decision lives in
 * `verifyCredentials`, which is plain server code. Everything here is framework
 * plumbing — session strategy, cookie handling, and what goes into the token.
 *
 * Shape of the decision, and why:
 *
 *  - **Credentials provider only.** This is an internal tool for a handful of AXIS
 *    employees; there is no identity provider to federate to and no public
 *    registration to protect.
 *  - **JWT session strategy.** Auth.js does not support database sessions with the
 *    Credentials provider, and a JWT avoids adding `Account`/`Session` tables that
 *    would duplicate the existing `User` model.
 *  - **The token carries a user id and nothing else.** No role, no name, no email —
 *    every authorization decision re-reads the user row through the session DAL, so a
 *    role change or a deactivation takes effect on the very next request instead of
 *    whenever a token happens to expire. A stale claim inside a signed token is
 *    exactly the failure mode that makes "deactivate a user" not work.
 *
 * Nothing here logs a password, a hash, or a token.
 */

export { SIGN_IN_FAILED_MESSAGE, SIGN_IN_RATE_LIMITED_MESSAGE };

/** Lets the login screen show the throttle message specifically. */
export class SignInRateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // one working day

export const authConfig: NextAuthConfig = {
  // Auth.js reads AUTH_SECRET from the environment. It is a secret: never logged,
  // never sent to a client, never committed. Cookies are HttpOnly and SameSite=Lax
  // by default, and Auth.js switches to `__Secure-` cookies automatically on HTTPS.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  trustHost: true, // the app is reached by LAN IP as well as localhost
  providers: [
    Credentials({
      // Field metadata only — Auth.js never renders a page for us; `/login` is ours.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const result = await verifyCredentials({
          email: raw?.email,
          password: raw?.password,
        });

        if (!result.ok) {
          // One throttle case is worth distinguishing, because "try again in a
          // minute" is actionable and "wrong details" is not. Every other cause
          // returns the same nothing.
          if (result.cause === "RATE_LIMITED") throw new SignInRateLimitedError();
          return null;
        }

        // ONLY the id travels into the token. Everything else is re-read per request.
        return { id: result.userId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      // `session.user` is a thin carrier: the DAL replaces it with a freshly loaded
      // row before any authorization decision is made.
      if (session.user && typeof token.sub === "string") {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
