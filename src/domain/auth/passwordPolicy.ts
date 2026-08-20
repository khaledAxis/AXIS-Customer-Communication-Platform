/**
 * Password rules for AXIS staff accounts (ADR-0023).
 *
 * Pure: no I/O, no hashing, no framework imports. This module decides whether a
 * proposed password is ACCEPTABLE; turning it into a stored credential is the
 * server's job (`server/auth/password.ts`), and the two are deliberately separate so
 * nothing in `domain/` ever handles a hash.
 *
 * The policy favours length over character-class gymnastics: a long passphrase is
 * both stronger and easier to remember than a short string with a symbol bolted on.
 * A modest class requirement remains because this is an internal tool whose users
 * will otherwise pick a single dictionary word.
 *
 * IMPORTANT: no value passed through this module may ever be logged. Callers hold a
 * plaintext password for the length of one request and nothing else.
 */

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound. Argon2 has no practical limit, but an unbounded input is an easy way
 * to burn CPU on a login endpoint, so the request is refused before hashing.
 */
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordProblem =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "NEEDS_LETTER"
  | "NEEDS_NUMBER"
  | "NEEDS_MIXED_CASE"
  | "TOO_COMMON"
  | "CONTAINS_EMAIL"
  | "WHITESPACE_ONLY_DIFFERENCE"
  | "CONFIRMATION_MISMATCH";

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  TOO_LONG: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
  NEEDS_LETTER: "Include at least one letter.",
  NEEDS_NUMBER: "Include at least one number.",
  NEEDS_MIXED_CASE: "Include both upper-case and lower-case letters.",
  TOO_COMMON: "That password is too easy to guess. Choose something else.",
  CONTAINS_EMAIL: "Do not use your email address as your password.",
  WHITESPACE_ONLY_DIFFERENCE:
    "A password made only of spaces cannot be used.",
  CONFIRMATION_MISMATCH: "The two passwords do not match.",
};

/**
 * A deliberately small list. It is not a substitute for a breach corpus — it exists
 * to stop the handful of passwords a hurried person actually types, and the ADR
 * records that a real breached-password check is a follow-up.
 */
const OBVIOUS_PASSWORDS = [
  "password",
  "passw0rd",
  "password1",
  "letmein",
  "welcome",
  "qwerty",
  "iloveyou",
  "admin",
  "administrator",
  "changeme",
  "secret",
  "axis",
  "axisgps",
  "axis-gps",
  "12345678",
  "123456789",
  "1234567890",
  "abc123",
];

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PasswordCheckInput {
  password: string;
  /** When present, the password must not simply repeat it. */
  email?: string | null;
  /** When present, must match exactly. */
  confirmation?: string | null;
}

export interface PasswordCheckResult {
  ok: boolean;
  problems: PasswordProblem[];
  /** Friendly messages in the same order, for the UI. */
  messages: string[];
}

/**
 * Validates a proposed password.
 *
 * Returns EVERY problem rather than the first, so a person fixes their password once
 * instead of discovering the rules one refusal at a time.
 */
export function checkPassword(input: PasswordCheckInput): PasswordCheckResult {
  const problems: PasswordProblem[] = [];
  const password = input.password ?? "";

  if (password.trim() === "" && password.length > 0) {
    problems.push("WHITESPACE_ONLY_DIFFERENCE");
  }
  if (password.length < MIN_PASSWORD_LENGTH) problems.push("TOO_SHORT");
  if (password.length > MAX_PASSWORD_LENGTH) problems.push("TOO_LONG");
  if (!/\p{L}/u.test(password)) problems.push("NEEDS_LETTER");
  if (!/\d/.test(password)) problems.push("NEEDS_NUMBER");
  if (!(/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password))) {
    problems.push("NEEDS_MIXED_CASE");
  }

  const flattened = normalizeForComparison(password);
  // A trailing run of digits is the commonest way to "strengthen" a weak word, and
  // it adds almost nothing against a guesser: `password2026` is `password`. The stem
  // is compared, not just the whole string.
  const stem = flattened.replace(/\d+$/, "");
  if (
    flattened.length > 0 &&
    OBVIOUS_PASSWORDS.some((weak) => flattened === weak || stem === weak)
  ) {
    problems.push("TOO_COMMON");
  }

  if (input.email) {
    const local = input.email.split("@")[0] ?? "";
    const emailFlat = normalizeForComparison(input.email);
    const localFlat = normalizeForComparison(local);
    if (
      flattened.length > 0 &&
      (flattened === emailFlat || (localFlat.length >= 3 && flattened === localFlat))
    ) {
      problems.push("CONTAINS_EMAIL");
    }
  }

  if (input.confirmation !== undefined && input.confirmation !== null) {
    // Compared byte-for-byte, never trimmed: a trailing space a person typed twice
    // is part of their password, and "helpfully" trimming one side would lock them out.
    if (input.confirmation !== password) problems.push("CONFIRMATION_MISMATCH");
  }

  return {
    ok: problems.length === 0,
    problems,
    messages: problems.map((problem) => PASSWORD_PROBLEM_MESSAGE[problem]),
  };
}

/**
 * A coarse strength hint for the UI. Advisory only — `checkPassword` is the gate, and
 * a "strong" reading never bypasses it.
 */
export function passwordStrength(password: string): "weak" | "fair" | "strong" {
  const classes =
    Number(/\p{Ll}/u.test(password)) +
    Number(/\p{Lu}/u.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^\p{L}\d]/u.test(password));

  if (password.length >= 16 && classes >= 3) return "strong";
  if (password.length >= MIN_PASSWORD_LENGTH && classes >= 3) return "fair";
  return "weak";
}
