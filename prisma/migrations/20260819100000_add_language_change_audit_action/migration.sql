-- Audit action for staff-assigned communication language (ADR-0020).
-- Language is LOCAL-owned: a Monday sync never writes it, so every change has a
-- human behind it and must be attributable.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMMUNICATION_LANGUAGE_CHANGED';
