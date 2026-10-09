-- =============================================
-- Thoddoo Marine – Secure Random Helper & Prefilled Details 012
--
-- 1. Restore public._gen_random_bytes(integer)
--    Uses unqualified gen_random_bytes() so it works
--    whether Supabase installed pgcrypto in public or extensions.
--    Adds input validation (1–64 bytes).
--    Locked to internal use only (no browser-role GRANT).
--
-- 2. Correct get_checkin_prefilled_details(text)
--    Hotel and room now loaded from the session's trusted
--    bookings record instead of the customer profile.
--    Public bookings store hotel_name/room_number on bookings;
--    the customer profile may be blank.
--    Preserves all existing security: hashed tokens, expiry,
--    single-use, authorization checks, anon-only GRANT.
--
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 1. public._gen_random_bytes(p_length integer)
-- =============================================
-- Internal helper. Called only by SECURITY DEFINER RPCs.
-- Uses unqualified gen_random_bytes() so it resolves
-- regardless of whether pgcrypto is in public or extensions.

-- 010 created the helper as _gen_random_bytes(n INT); Postgres refuses to
-- rename an input parameter with CREATE OR REPLACE. The helper is already
-- referenced by booking_participants.choice_token's default, so drop that
-- default first, swap the function, then restore it. Idempotent.
ALTER TABLE public.booking_participants ALTER COLUMN choice_token DROP DEFAULT;
DROP FUNCTION IF EXISTS public._gen_random_bytes(integer);

CREATE OR REPLACE FUNCTION public._gen_random_bytes(p_length integer)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_length IS NULL OR p_length < 1 OR p_length > 64 THEN
    RAISE EXCEPTION 'Invalid byte length: %. Must be between 1 and 64.', p_length
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN gen_random_bytes(p_length);
END;
$$;

REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM anon;
REVOKE ALL ON FUNCTION public._gen_random_bytes(integer) FROM authenticated;

-- Restore the column default now that the helper exists again.
ALTER TABLE public.booking_participants
  ALTER COLUMN choice_token SET DEFAULT encode(public._gen_random_bytes(12), 'hex');

-- =============================================
-- 2. get_checkin_prefilled_details (corrected)
-- =============================================
-- Canonical signature: (p_verification_token TEXT)
-- Returns JSON with guest details for consent form.
-- Permissions: REVOKE ALL FROM PUBLIC, REVOKE ALL FROM authenticated, GRANT anon
--
-- FIX: Hotel and room now come from the session's trusted
--      bookings record, not the customer profile.
--      Public bookings store hotel_name/room_number on the
--      bookings table; the customer profile may be blank.

CREATE OR REPLACE FUNCTION public.get_checkin_prefilled_details(
  p_verification_token TEXT
)
RETURNS JSON AS $$
DECLARE
  v_vt_hash TEXT;
  v_vt consent_checkin_verification_tokens%ROWTYPE;
  v_session consent_checkin_sessions%ROWTYPE;
  v_participant booking_participants%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_activity_name TEXT;
  v_template consent_templates%ROWTYPE;
  v_full_name TEXT;
  v_nationality TEXT;
  v_phone TEXT;
  v_hotel TEXT;
  v_room TEXT;
  v_dob DATE;
  v_passport TEXT;
  v_emergency_name TEXT;
  v_emergency_phone TEXT;
BEGIN
  IF p_verification_token IS NULL OR p_verification_token = '' THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid session. Please start again.');
  END IF;

  v_vt_hash := public._hash_token(p_verification_token);

  SELECT * INTO v_vt
  FROM consent_checkin_verification_tokens
  WHERE token_hash = v_vt_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session expired or invalid. Please start again.');
  END IF;

  IF v_vt.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'Session expired. Please scan the QR code again.');
  END IF;

  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'This session has already been used.');
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = v_vt.session_id;
  SELECT * INTO v_participant FROM booking_participants WHERE id = v_vt.participant_id;
  SELECT name INTO v_activity_name FROM activities WHERE id = v_session.activity_id;

  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = 'activity' AND active = true;

  -- Customer profile: name, nationality, phone, DOB, passport, emergency
  IF v_participant.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_participant.customer_id;
    IF FOUND THEN
      v_full_name := v_customer.full_name;
      v_nationality := v_customer.nationality;
      v_phone := v_customer.phone;
      v_dob := v_customer.date_of_birth;
      v_passport := v_customer.passport_number;
      v_emergency_name := v_customer.emergency_contact_name;
      v_emergency_phone := v_customer.emergency_contact_phone;
    END IF;
  END IF;

  -- Hotel and room from the session's trusted booking record
  -- (public bookings store hotel/room on bookings, not customers)
  IF v_session.booking_id IS NOT NULL THEN
    SELECT hotel_name, room_number INTO v_hotel, v_room
    FROM bookings
    WHERE id = v_session.booking_id;
  END IF;

  IF v_full_name IS NULL THEN
    v_full_name := v_participant.full_name;
  END IF;

  RETURN json_build_object(
    'guest_name', v_full_name,
    'nationality', v_nationality,
    'phone', v_phone,
    'hotel', v_hotel,
    'room_number', v_room,
    'date_of_birth', v_dob,
    'passport_number', v_passport,
    'emergency_contact_name', v_emergency_name,
    'emergency_contact_phone', v_emergency_phone,
    'activity_name', v_activity_name,
    'is_minor', v_participant.participant_type = 'child',
    'guardian_name', v_participant.guardian_name,
    'consent_version', v_template.version,
    'consent_text', v_template.consent_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkin_prefilled_details(TEXT) TO anon;
