-- =============================================
-- Thoddoo Marine – Check-in RPC Permissions & Runtime Audit 013
-- =============================================
--
-- ROOT CAUSE
-- ----------
-- Runtime error on the public /checkin page (anon client):
--   "permission denied for function get_checkin_participants"
--
-- In PostgreSQL, REVOKE ALL FROM PUBLIC removes the default
-- PUBLIC EXECUTE grant inherited by all roles.  Migration 010
-- issued explicit GRANT EXECUTE TO anon for every guest RPC,
-- but the live database does not reflect those grants —
-- indicating they were dropped or never persisted, possibly
-- due to a migration transaction boundary issue.
--
-- Additionally, migration 010 created public._hash_token
-- without any REVOKE, so PUBLIC (and therefore anon and
-- authenticated) could call it directly.  This migration
-- corrects both issues.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--  Task 2 – Re-grant guest check-in RPCs to anon only.
--  Task 3 – Lock down internal helpers (_hash_token,
--            _gen_random_bytes) from all browser roles.
--  Task 4 – Re-grant staff RPCs to authenticated only.
--  Task 5 – Documented: SECURITY DEFINER and search_path are
--            already correct in migrations 010–012; this
--            migration does not redefine any function body.
--  Task 6 – Documented: no obsolete overloads exist (see below).
--
-- WHAT THIS MIGRATION DOES NOT DO
-- --------------------------------
--  - Does not modify any function body.
--  - Does not re-apply or duplicate migrations 010–012.
--  - Does not grant table-level access to any role.
--  - Does not grant internal helpers to browser roles.
--  - Does not drop any canonical function.
--
-- SAFE TO RE-RUN
-- REVOKE on a non-existent grant is a no-op in PostgreSQL.
-- GRANT EXECUTE is idempotent when the grant already exists.
-- =============================================


-- =============================================
-- TASK 2: Guest check-in RPCs — anon only
--
-- Exact canonical signatures from migrations 010–012.
-- Each function is SECURITY DEFINER and uses
--   SET search_path = public, extensions
-- as established in the original migration.  This migration
-- does not alter function bodies; it only restores the
-- correct EXECUTE grants.
-- =============================================

-- 2a. get_checkin_participants(p_token TEXT)
-- Defined: migration 010.
-- Returns masked participant list with choice_tokens.
-- Must not be callable by authenticated staff via this path.
REVOKE ALL ON FUNCTION public.get_checkin_participants(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_participants(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkin_participants(TEXT) TO anon;

-- 2b. verify_checkin_participant(p_token TEXT, p_choice_token TEXT, p_verification_code TEXT)
-- Canonical version: migration 011 (replaced migration 010 version via CREATE OR REPLACE).
-- Returns a short-lived verification token on successful identity check.
REVOKE ALL ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) TO anon;

-- 2c. verify_walkin_participant(p_token TEXT, p_full_name TEXT, p_phone_last4 TEXT)
-- Defined: migration 010.
-- Walk-in guest self-registration; creates participant and verification token.
REVOKE ALL ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) TO anon;

-- 2d. get_checkin_prefilled_details(p_verification_token TEXT)
-- Canonical version: migration 012 (replaced migration 010 version via CREATE OR REPLACE).
-- Returns permitted guest details after successful verification.
-- Hotel and room come from the session's trusted bookings record.
REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkin_prefilled_details(TEXT) TO anon;

-- 2e. submit_checkin_consent(
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
-- 17 parameters: TEXT×6, BOOLEAN×5, TEXT×6.
-- Defined: migration 010.
-- Creates and signs consent form; consumes verification token atomically.
REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;


-- =============================================
-- TASK 3: Internal helpers — revoked from all browser roles
--
-- These functions are called exclusively from SECURITY DEFINER
-- RPCs, which run as the function owner (postgres superuser).
-- The owner does not need an explicit EXECUTE grant on its own
-- functions — it always has all privileges.  Browser roles
-- (anon, authenticated) must never call these directly.
-- =============================================

-- 3a. _hash_token(p_token TEXT)
-- Defined: migration 010 WITHOUT any REVOKE.
-- Default PostgreSQL behavior grants EXECUTE to PUBLIC on new
-- functions.  This must now be explicitly removed.
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public._hash_token(TEXT) FROM authenticated;

-- 3b. _gen_random_bytes(p_length integer)
-- Canonical version: migration 012 plpgsql implementation.
-- Migration 010 created _gen_random_bytes(n INT) as SQL.
-- INT and integer are the same PostgreSQL type (int4).
-- Migration 012's CREATE OR REPLACE replaced the migration 010
-- version in-place; only one overload exists in the database.
-- The canonical parameter type name is integer (used in 012).
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM anon;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM authenticated;


-- =============================================
-- TASK 4: Staff check-in RPCs — authenticated only
--
-- These functions contain their own internal role checks
-- (v_role NOT IN ('owner', 'manager', 'reception')) which
-- reject inactive, unregistered, and restricted staff.
-- The GRANT TO authenticated is a coarse gate; the function
-- body enforces the fine-grained access control.
-- =============================================

-- 4a. create_checkin_session(p_booking_id UUID, p_activity_id UUID, p_is_walkin BOOLEAN)
-- Defined: migration 010.
REVOKE ALL ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) TO authenticated;

-- 4b. revoke_checkin_session(p_session_id UUID)
-- Defined: migration 010.
REVOKE ALL ON FUNCTION public.revoke_checkin_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_checkin_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_checkin_session(UUID) TO authenticated;

-- 4c. get_checkin_session_status(p_session_id UUID)
-- Defined: migration 010.
REVOKE ALL ON FUNCTION public.get_checkin_session_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_session_status(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_session_status(UUID) TO authenticated;


-- =============================================
-- TASK 5: SECURITY DEFINER and search_path — no change required
-- =============================================
-- All check-in RPCs already use:
--   SECURITY DEFINER SET search_path = public, extensions
-- as established in their original migration.
--
-- This migration does NOT redefine any function body.  The
-- SECURITY DEFINER attribute and search_path are preserved
-- exactly as written in migrations 010, 011, and 012.
--
-- No anon SELECT/INSERT/UPDATE/DELETE is granted on:
--   booking_participants, consent_checkin_sessions,
--   consent_checkin_attempts, consent_checkin_verification_tokens,
--   customers, bookings, consent_forms.
-- All table access occurs exclusively through SECURITY DEFINER
-- RPCs running as the database owner.


-- =============================================
-- TASK 6: Obsolete overload audit
-- =============================================
-- All potential overloads were examined.  No DROP required.
--
-- public._gen_random_bytes:
--   Migration 010: CREATE OR REPLACE FUNCTION public._gen_random_bytes(n INT)
--                  LANGUAGE sql, IMMUTABLE STRICT
--   Migration 012: CREATE OR REPLACE FUNCTION public._gen_random_bytes(p_length integer)
--                  LANGUAGE plpgsql
--   Analysis: INT and integer are identical PostgreSQL types (int4).
--   The signatures match; migration 012's CREATE OR REPLACE replaced
--   the migration 010 body in-place.  Exactly one overload exists.
--   PostgREST resolves this function name unambiguously.
--   Action: No DROP required.
--
-- public.get_checkin_prefilled_details:
--   Migration 010: CREATE OR REPLACE FUNCTION public.get_checkin_prefilled_details(p_verification_token TEXT)
--   Migration 012: CREATE OR REPLACE FUNCTION public.get_checkin_prefilled_details(p_verification_token TEXT)
--   Analysis: Identical signatures.  Migration 012 replaced 010 in-place.
--   Exactly one overload exists.
--   Action: No DROP required.
--
-- public.verify_checkin_participant:
--   Migration 010: CREATE OR REPLACE FUNCTION public.verify_checkin_participant(p_token TEXT, p_choice_token TEXT, p_verification_code TEXT)
--   Migration 011: CREATE OR REPLACE FUNCTION public.verify_checkin_participant(p_token TEXT, p_choice_token TEXT, p_verification_code TEXT)
--   Analysis: Identical signatures.  Migration 011 replaced 010 in-place.
--   Exactly one overload exists.
--   Action: No DROP required.
--
-- All other check-in RPCs were defined once and never overloaded.
-- PostgREST RPC name/signature resolution is unambiguous for all
-- check-in function names.
-- No broad DROP FUNCTION statements without parameter types are used.
