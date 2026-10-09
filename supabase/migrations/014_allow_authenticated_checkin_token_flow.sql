-- =============================================
-- Thoddoo Marine – Allow Authenticated Check-in Token Flow 014
-- =============================================
--
-- ROOT CAUSE
-- ----------
-- Migration 013 issued REVOKE ALL FROM authenticated for every
-- guest check-in RPC.  That was correct security intent: these
-- RPCs are designed for anonymous guest use.
--
-- However, the real-world deployment revealed a second path:
-- a browser that already holds an authenticated Supabase session
-- (e.g. a staff member testing the QR flow, or a guest whose
-- browser retains a prior login) submits the RPC call as role
-- "authenticated", not "anon".  PostgreSQL then returns:
--
--   ERROR 42501: permission denied for function get_checkin_participants
--
-- The functions are HIGH-ENTROPY TOKEN-PROTECTED, not
-- role-protected.  All authorization is performed inside the
-- SECURITY DEFINER function body:
--   - session_token_hash must match a valid, unexpired,
--     non-revoked session row
--   - attempt counts are enforced
--   - verification tokens are single-use and participant-bound
--
-- Granting EXECUTE to authenticated does NOT bypass any of
-- that validation.  The role that calls the function has no
-- bearing on what data it can access; the function always runs
-- as its owner (postgres) under SECURITY DEFINER.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- For each of the five token-protected guest RPCs, add:
--   GRANT EXECUTE TO authenticated;
--
-- The existing GRANT EXECUTE TO anon (applied by earlier
-- migrations and re-applied below) is preserved.
-- REVOKE ALL FROM PUBLIC is re-stated for clarity.
--
-- Nothing else changes:
--   - No function body is modified.
--   - No search_path is changed.
--   - No table access is granted.
--   - Internal helpers remain revoked from all browser roles.
--   - Staff-management RPCs are untouched.
--
-- SAFE TO RE-RUN (idempotent)
-- REVOKE on a non-existent grant is a no-op in PostgreSQL.
-- GRANT EXECUTE is idempotent when the grant already exists.
-- =============================================


-- =============================================
-- Token-protected guest RPCs
--
-- These five functions use high-entropy opaque tokens for all
-- authorization.  The calling role is irrelevant to security;
-- the function validates every request against hashed token
-- rows that only the database owner can create.
--
-- Both anon and authenticated must be able to call them because
-- a browser may hold either role depending on whether the user
-- previously logged in.
-- =============================================

-- get_checkin_participants(p_token TEXT)
-- Returns masked participant list; validates session token hash.
REVOKE ALL ON FUNCTION public.get_checkin_participants(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_checkin_participants(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_participants(TEXT) TO authenticated;

-- verify_checkin_participant(p_token TEXT, p_choice_token TEXT, p_verification_code TEXT)
-- Identity verification via room/phone; canonical version: migration 011.
REVOKE ALL ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) TO authenticated;

-- verify_walkin_participant(p_token TEXT, p_full_name TEXT, p_phone_last4 TEXT)
-- Walk-in guest self-registration; validates session token hash.
REVOKE ALL ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) TO authenticated;

-- get_checkin_prefilled_details(p_verification_token TEXT)
-- Returns permitted guest details; validates verification token hash + single-use.
-- Canonical version: migration 012.
REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_checkin_prefilled_details(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_prefilled_details(TEXT) TO authenticated;

-- submit_checkin_consent(
--   p_verification_token TEXT,
--   p_swimming_ability TEXT, p_medical_conditions TEXT,
--   p_allergies TEXT, p_medications TEXT, p_recent_injuries TEXT,
--   p_is_pregnant BOOLEAN, p_safety_briefing_confirmed BOOLEAN,
--   p_life_jacket_confirmed BOOLEAN, p_risk_acknowledged BOOLEAN,
--   p_photo_consent BOOLEAN,
--   p_signature_data_url TEXT, p_witness_name TEXT,
--   p_witness_signature_data_url TEXT, p_parent_guardian_name TEXT,
--   p_parent_guardian_relationship TEXT,
--   p_parent_guardian_signature_data_url TEXT)
-- Creates and signs consent form; consumes verification token atomically.
REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- =============================================
-- Internal helpers — remain locked from all browser roles
--
-- These are called only from SECURITY DEFINER RPCs running as
-- the database owner.  No browser role should call them directly.
-- Re-stated here for defence-in-depth; not changed from 012/013.
-- =============================================

REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM anon;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM authenticated;


-- =============================================
-- Staff-management RPCs — unchanged
--
-- create_checkin_session, revoke_checkin_session, and
-- get_checkin_session_status remain authenticated-only.
-- Their grants are not modified here.
-- =============================================
