-- =============================================
-- Thoddoo Marine – Fix Check-in Consent Submission 015
--
-- Root cause of PostgreSQL 42883 on submit_checkin_consent:
--   The browser client omitted p_parent_guardian_relationship from
--   the 17-parameter RPC call. PostgREST/PostgreSQL could not resolve
--   the function against the provided 16-argument signature. Fixed in
--   CheckinClient.tsx (client-side).
--
-- Root cause of secondary PostgreSQL 23514 (check_violation):
--   Migration 009 added:
--     CHECK (signing_method IN ('guest_token', 'staff_assisted'))
--   Migration 010's submit_checkin_consent INSERTs signing_method =
--   'guest_checkin' for QR-based guest consent. This value was not
--   included in migration 009's constraint.
--   This migration corrects the constraint to include 'guest_checkin'.
--
-- Does NOT modify migrations 001–014.
-- Does NOT change any function body or search_path.
-- Does NOT grant direct table access to anon or authenticated.
-- Does NOT alter submit_checkin_consent — the function body is correct.
-- =============================================

BEGIN;

-- =============================================
-- 1. Extend signing_method constraint to include 'guest_checkin'
-- =============================================
-- Migration 009 constrained signing_method to ('guest_token', 'staff_assisted').
-- Migration 010 introduced 'guest_checkin' as the method for QR guest self-signing.
-- The constraint must be updated to allow all three legitimate values.

DO $$
BEGIN
  -- Drop the old constraint if it exists with only 2 values
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_forms_signing_method_check'
      AND conrelid = 'consent_forms'::regclass
  ) THEN
    ALTER TABLE consent_forms
      DROP CONSTRAINT consent_forms_signing_method_check;
  END IF;

  -- Add the corrected constraint including 'guest_checkin'
  ALTER TABLE consent_forms
    ADD CONSTRAINT consent_forms_signing_method_check
    CHECK (signing_method IN ('guest_token', 'staff_assisted', 'guest_checkin'));
END $$;

-- =============================================
-- 2. Re-confirm submit_checkin_consent permissions
-- =============================================
-- The function remains SECURITY DEFINER with SET search_path = public, extensions.
-- Anon and authenticated may both call it (token-protected, not role-protected).
-- The 17-parameter canonical signature is identical to migration 010.

REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================
-- 3. Internal helpers remain locked
-- =============================================

REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM anon;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM authenticated;

COMMIT;
