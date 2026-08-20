/**
 * Shared authentication vocabulary (ADR-0023).
 *
 * Kept in its own module so the audit writer and the credential check can both use it
 * without either importing the Auth.js wiring — and so nothing that merely needs a
 * message drags the HTTP auth stack in with it.
 */

/**
 * Distinguishable causes, for the AUDIT TRAIL only.
 *
 * None of these ever reaches a browser: every failure is reported to the caller as
 * one generic sentence, because telling an anonymous visitor which of these it was is
 * telling them which addresses exist.
 */
export type SignInFailureCause =
  | "MALFORMED_INPUT"
  | "UNKNOWN_EMAIL"
  | "BAD_PASSWORD"
  | "INACTIVE"
  | "SYSTEM_ACCOUNT"
  | "RATE_LIMITED";

/** The only sign-in failure message the application shows. */
export const SIGN_IN_FAILED_MESSAGE =
  "Those details do not match an active AXIS account.";

export const SIGN_IN_RATE_LIMITED_MESSAGE =
  "Too many sign-in attempts. Wait a minute and try again.";
