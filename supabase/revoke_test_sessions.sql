-- =============================================
-- Revoke ALL active check-in sessions created during testing.
-- No raw tokens are printed or logged.
-- Safe to run: idempotent, only affects un-revoked sessions.
-- =============================================

BEGIN;

-- Invalidate all unused verification tokens for active sessions
UPDATE consent_checkin_verification_tokens
SET used_at = now()
WHERE used_at IS NULL;

-- Revoke all un-revoked sessions
UPDATE consent_checkin_sessions
SET revoked_at = now()
WHERE revoked_at IS NULL;

COMMIT;
