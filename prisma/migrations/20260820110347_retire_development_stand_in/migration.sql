-- Retire the pre-authentication development stand-in (ADR-0023).
--
-- Earlier milestones attributed every action to `dev-local@axis-gps.invalid`, whose
-- password column held a literal placeholder string. It is an ADMIN row, so leaving it
-- as-is would make the platform look already-bootstrapped and permanently close the
-- one-time `/setup` door before a real administrator could ever be created.
--
-- It is NOT deleted and NOT promoted:
--   * historical campaigns, approvals and audit rows reference its id, and rewriting
--     them to name a real employee would fabricate a record of who did what;
--   * promoting it would hand a real session to an account nobody owns.
--
-- Instead it becomes a system account: readable as history, and unable to sign in or
-- approve anything. `!no-login` is deliberately not a valid Argon2 hash, so
-- `verifyPassword` refuses it before doing any work.
--
-- Idempotent: re-running changes nothing.
UPDATE "User"
SET "isSystemAccount" = true,
    "isActive"        = false,
    "passwordHash"    = '!no-login',
    "deactivatedAt"   = COALESCE("deactivatedAt", NOW())
WHERE "email" = 'dev-local@axis-gps.invalid'
  AND ("isSystemAccount" = false OR "isActive" = true);
