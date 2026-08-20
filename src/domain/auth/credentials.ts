import { normalizeEmail } from "../email/normalizeEmail";
import { Role, isRole } from "./authorization";
import { checkPassword, type PasswordCheckResult } from "./passwordPolicy";

/**
 * Parsing untrusted authentication and user-administration input (ADR-0023).
 *
 * Pure: no I/O, no hashing, no database. Everything here is shape validation, so the
 * server layer receives typed values and never inspects a raw `FormData` field.
 *
 * Two things this module deliberately cannot express:
 *
 *  - a ROLE chosen by whoever is signing in. Sign-in carries an email and a password
 *    and nothing else; the role comes from the database row.
 *  - an ACTOR id. No parsed shape here has a `userId`, `actorId` or `approverId`
 *    field, so a browser cannot claim to be someone by adding a form input.
 */

export const SIGN_IN_REJECTION_MESSAGE = {
  MISSING: "Enter your email address and password.",
  MALFORMED: "Enter a valid email address.",
} as const;

export type SignInRejection = keyof typeof SIGN_IN_REJECTION_MESSAGE;

export class SignInInputError extends Error {
  readonly reason: SignInRejection;

  constructor(reason: SignInRejection) {
    super(SIGN_IN_REJECTION_MESSAGE[reason]);
    this.name = "SignInInputError";
    this.reason = reason;
  }
}

export interface SignInCredentials {
  /** Normalized (lower-cased, trimmed) — the form email lookups use. */
  email: string;
  password: string;
}

/**
 * Parses a sign-in submission.
 *
 * The password is NOT trimmed, normalized, or length-checked against the creation
 * policy: it is compared to a stored hash exactly as typed. Applying the creation
 * policy here would leak which rules an existing password satisfies, and trimming
 * would silently lock out anyone whose password ends in a space.
 */
export function parseSignIn(input: {
  email: unknown;
  password: unknown;
}): SignInCredentials {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new SignInInputError("MISSING");
  }
  if (input.email.trim() === "" || input.password === "") {
    throw new SignInInputError("MISSING");
  }

  const parsed = normalizeEmail(input.email);
  if (parsed.kind !== "valid") throw new SignInInputError("MALFORMED");

  return { email: parsed.normalized, password: input.password };
}

// ---------------------------------------------------------------------------
// Creating and editing accounts (administrator only — enforced in the service)
// ---------------------------------------------------------------------------

export const MAX_NAME_LENGTH = 120;

export type UserInputProblem =
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "ROLE_INVALID"
  | "PASSWORD";

export interface UserInputIssue {
  field: "name" | "email" | "role" | "password";
  message: string;
}

export class UserInputError extends Error {
  readonly issues: UserInputIssue[];

  constructor(issues: UserInputIssue[]) {
    super(issues[0]?.message ?? "That could not be saved.");
    this.name = "UserInputError";
    this.issues = issues;
  }
}

export interface NewUserInput {
  name: string;
  email: string;
  role: Role;
  password: string;
}

/**
 * Parses a "create this staff account" submission.
 *
 * Every problem is collected, so an administrator fixes the form once. The password
 * is validated against the full creation policy here; it is hashed by the server and
 * never returned, logged, or stored in any other form.
 */
export function parseNewUser(input: {
  name: unknown;
  email: unknown;
  role: unknown;
  password: unknown;
  confirmPassword?: unknown;
}): NewUserInput {
  const issues: UserInputIssue[] = [];

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") issues.push({ field: "name", message: "Enter the person's name." });
  else if (name.length > MAX_NAME_LENGTH) {
    issues.push({ field: "name", message: `Keep the name under ${MAX_NAME_LENGTH} characters.` });
  }

  let email = "";
  if (typeof input.email !== "string" || input.email.trim() === "") {
    issues.push({ field: "email", message: "Enter an email address." });
  } else {
    const parsed = normalizeEmail(input.email);
    if (parsed.kind !== "valid") {
      issues.push({ field: "email", message: "Enter a valid email address." });
    } else {
      email = parsed.normalized;
    }
  }

  if (!isRole(input.role)) {
    issues.push({ field: "role", message: "Choose Administrator or Manager." });
  }

  const password = typeof input.password === "string" ? input.password : "";
  const passwordCheck: PasswordCheckResult = checkPassword({
    password,
    email: email || null,
    confirmation:
      input.confirmPassword === undefined
        ? undefined
        : typeof input.confirmPassword === "string"
          ? input.confirmPassword
          : "",
  });
  for (const message of passwordCheck.messages) {
    issues.push({ field: "password", message });
  }

  if (issues.length > 0) throw new UserInputError(issues);

  return { name, email, role: input.role as Role, password };
}

export interface PasswordChangeInput {
  password: string;
}

/** Parses a "set this password" submission (bootstrap, reset, self-change). */
export function parsePasswordChange(input: {
  password: unknown;
  confirmPassword: unknown;
  email?: string | null;
}): PasswordChangeInput {
  const password = typeof input.password === "string" ? input.password : "";
  const confirmation =
    typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const result = checkPassword({
    password,
    email: input.email ?? null,
    confirmation,
  });
  if (!result.ok) {
    throw new UserInputError(
      result.messages.map((message) => ({ field: "password" as const, message })),
    );
  }
  return { password };
}
