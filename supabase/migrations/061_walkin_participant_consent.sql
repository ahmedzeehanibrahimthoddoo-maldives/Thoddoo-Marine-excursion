-- ================================================================
-- 061 — WALK-IN PER-PARTICIPANT CONSENT SIGNING (v2 wizard)
-- ================================================================
-- The multi-activity walk-in wizard (migration 060) books a GROUP of N
-- participants across several activities. Each participant row in
-- booking_participants has its own server-generated choice_token, and
-- CONSENT IS PER PARTICIPANT — every participant must individually sign
-- the activity consent / liability waiver (minors via parent/guardian).
--
-- 060's comment claimed "no new signing RPC needed (choice_token is the
-- auth key)" but the existing anon walk-in RPC submit_walkin_consent
-- (036) keys on booking_ref + lead phone and records one booking-level
-- consent; submit_checkin_consent (010) is per-participant but requires a
-- verification token minted from a staff-created check-in session, which
-- a fresh public walk-in booking does not have.
--
-- This migration adds ONE anon RPC that signs a SINGLE participant:
--   public.submit_walkin_participant_consent(
--     p_choice_token, p_phone, ...guest + safety + signature fields... )
-- Auth: the opaque choice_token identifies the booking_participants row;
-- the phone must match the booking's lead customer (same phone-or-last-4
-- rule as 036). Writes a consent_forms row (guest_name = participant's
-- own name) and flips the participant row to consent_status = 'signed'.
--
-- Idempotent + safe to re-run. Adds no signing_method values (reuses the
-- already-allowed 'guest_checkin').
-- ================================================================

BEGIN;

-- ================================================================
-- submit_walkin_participant_consent
-- ================================================================
-- Keys per participant via choice_token (migration 060 promised this),
-- not per booking. Mirrors submit_checkin_consent (010)'s participant
-- update + consent_forms insert, and submit_walkin_consent (036)'s guest
-- details + phone ownership checks.

CREATE OR REPLACE FUNCTION public.submit_walkin_participant_consent(
  p_choice_token                TEXT,
  p_phone                       TEXT,
  p_nationality                 TEXT DEFAULT NULL,
  p_date_of_birth               DATE DEFAULT NULL,
  p_passport_number             TEXT DEFAULT NULL,
  p_emergency_contact_name      TEXT DEFAULT NULL,
  p_emergency_contact_phone     TEXT DEFAULT NULL,
  p_swimming_ability            TEXT DEFAULT NULL,
  p_medical_conditions          TEXT DEFAULT NULL,
  p_allergies                   TEXT DEFAULT NULL,
  p_medications                 TEXT DEFAULT NULL,
  p_recent_injuries             TEXT DEFAULT NULL,
  p_is_pregnant                 BOOLEAN DEFAULT FALSE,
  p_safety_briefing_confirmed   BOOLEAN DEFAULT FALSE,
  p_life_jacket_confirmed       BOOLEAN DEFAULT FALSE,
  p_risk_acknowledged           BOOLEAN DEFAULT FALSE,
  p_photo_consent               BOOLEAN DEFAULT FALSE,
  p_signature_data_url          TEXT DEFAULT NULL,
  p_witness_name                TEXT DEFAULT NULL,
  p_witness_signature_data_url  TEXT DEFAULT NULL,
  p_parent_guardian_name        TEXT DEFAULT NULL,
  p_parent_guardian_relationship TEXT DEFAULT NULL,
  p_parent_guardian_signature_data_url TEXT DEFAULT NULL,
  p_expected_consent_version    TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_participant RECORD;
  v_customer    RECORD;
  v_booking     RECORD;
  v_template    RECORD;
  v_consent_id  UUID;
  v_customer_id UUID;
  v_payload     TEXT;
  v_sig_bytes   INT;
  v_phone_norm  TEXT;
  v_fk_col      TEXT;
BEGIN
  -- ---------- validation ----------
  IF p_choice_token IS NULL OR p_choice_token = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Participant token is required.');
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Phone number is required.');
  END IF;

  -- booking_participants FK column: 010 created it as booking_id. Resolve
  -- at runtime so this stays correct if a rename (parent_booking_id) ever
  -- lands on a given deploy.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_participants'
      AND column_name = 'parent_booking_id'
  ) THEN 'parent_booking_id' ELSE 'booking_id' END
  INTO v_fk_col;

  SELECT bp.* INTO v_participant
  FROM public.booking_participants bp
  WHERE bp.choice_token = p_choice_token;

  IF v_participant.id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Participant not found. Please refresh and try again.');
  END IF;

  -- Idempotency: already signed
  IF v_participant.consent_status = 'signed' THEN
    RETURN json_build_object('success', true, 'already_signed', true, 'message', 'Consent already submitted for this participant.');
  END IF;

  -- Ensure the participant belongs to a live booking
  EXECUTE format(
    'SELECT b.* FROM public.bookings b
       JOIN public.booking_participants bp ON bp.id = %L
     WHERE b.id = bp.%I',
    v_participant.id, v_fk_col
  ) INTO v_booking;

  IF v_booking.id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Booking not found for this participant.');
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RETURN json_build_object('error', 'validation', 'message', 'This booking has been cancelled.');
  END IF;

  -- Phone match against the booking's lead customer (same rule as 036)
  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_booking.customer_id;
  v_phone_norm := regexp_replace(trim(p_phone), '[^0-9]', '', 'g');
  IF (v_customer.id IS NULL OR v_customer.phone IS NULL)
     OR (
       regexp_replace(v_customer.phone, '[^0-9]', '', 'g') <> v_phone_norm
       AND right(regexp_replace(v_customer.phone, '[^0-9]', '', 'g'), 4) <> right(v_phone_norm, 4)
     ) THEN
    RETURN json_build_object('error', 'verification_failed', 'message', 'The phone number does not match this booking.');
  END IF;

  -- ---------- safety acknowledgements ----------
  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  -- ---------- signature validation ----------
  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature is required.');
  END IF;
  IF p_signature_data_url NOT LIKE 'data:image/png;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpeg;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpg;base64,%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature must be a PNG or JPEG data URL.');
  END IF;

  v_payload := split_part(p_signature_data_url, ',', 2);
  IF length(v_payload) > 699050 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size of 512 KB.');
  END IF;

  BEGIN
    v_sig_bytes := length(decode(v_payload, 'base64'));
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature contains invalid data.');
  END;

  IF v_sig_bytes > 524288 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size of 512 KB.');
  END IF;

  -- ---------- minor handling ----------
  IF v_participant.participant_type = 'child' THEN
    IF p_parent_guardian_name IS NULL OR trim(p_parent_guardian_name) = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
    END IF;
    IF p_parent_guardian_relationship IS NULL OR trim(p_parent_guardian_relationship) = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Guardian relationship is required for minors.');
    END IF;
    IF p_parent_guardian_signature_data_url IS NULL OR p_parent_guardian_signature_data_url = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian signature is required for minors.');
    END IF;
  END IF;

  -- ---------- active consent template ----------
  SELECT t.* INTO v_template
  FROM public.consent_templates t
  WHERE t.consent_type = 'activity' AND t.active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  IF p_expected_consent_version IS NOT NULL
     AND p_expected_consent_version <> v_template.version THEN
    RETURN json_build_object(
      'error', 'terms_updated_refresh_required',
      'message', 'The consent terms have been updated. Please refresh and review the current version before signing.'
    );
  END IF;

  -- ---------- customer for the participant ----------
  IF v_participant.customer_id IS NULL THEN
    INSERT INTO public.customers (full_name)
    VALUES (v_participant.full_name)
    RETURNING id INTO v_customer_id;
    UPDATE public.booking_participants SET customer_id = v_customer_id WHERE id = v_participant.id;
  ELSE
    v_customer_id := v_participant.customer_id;
  END IF;

  UPDATE public.customers SET
    nationality             = COALESCE(NULLIF(trim(p_nationality), ''), nationality),
    date_of_birth           = COALESCE(p_date_of_birth, date_of_birth),
    passport_number         = COALESCE(NULLIF(trim(p_passport_number), ''), passport_number),
    emergency_contact_name  = COALESCE(NULLIF(trim(p_emergency_contact_name), ''), emergency_contact_name),
    emergency_contact_phone = COALESCE(NULLIF(trim(p_emergency_contact_phone), ''), emergency_contact_phone)
  WHERE id = v_customer_id;

  -- ---------- create + sign consent in one step ----------
  INSERT INTO public.consent_forms (
    booking_id,
    customer_id,
    activity_id,
    activity_name,
    booking_ref,
    guest_name,
    nationality,
    date_of_birth,
    passport_number,
    phone,
    hotel,
    room_number,
    emergency_contact_name,
    emergency_contact_phone,
    swimming_ability,
    medical_conditions,
    allergies,
    medications,
    recent_injuries,
    is_pregnant,
    safety_briefing_confirmed,
    life_jacket_confirmed,
    risk_acknowledged,
    photo_consent,
    signature_data_url,
    witness_name,
    witness_signature_data_url,
    parent_guardian_name,
    parent_guardian_signature_data_url,
    is_minor,
    consent_type,
    status,
    form_version,
    signed_at,
    consent_version,
    consent_text_snapshot,
    signing_method
  )
  VALUES (
    v_booking.id,
    v_customer_id,
    v_booking.activity_id,
    (SELECT name FROM public.activities WHERE id = v_booking.activity_id),
    v_booking.booking_ref,
    v_participant.full_name,
    NULLIF(trim(p_nationality), ''),
    p_date_of_birth,
    NULLIF(trim(p_passport_number), ''),
    v_customer.phone,
    COALESCE(v_booking.hotel_name, v_customer.hotel),
    COALESCE(v_booking.room_number, v_customer.room_number),
    NULLIF(trim(p_emergency_contact_name), ''),
    NULLIF(trim(p_emergency_contact_phone), ''),
    p_swimming_ability,
    p_medical_conditions,
    p_allergies,
    p_medications,
    p_recent_injuries,
    p_is_pregnant,
    p_safety_briefing_confirmed,
    p_life_jacket_confirmed,
    p_risk_acknowledged,
    p_photo_consent,
    p_signature_data_url,
    NULLIF(trim(p_witness_name), ''),
    p_witness_signature_data_url,
    COALESCE(NULLIF(trim(p_parent_guardian_name), ''), v_participant.guardian_name),
    p_parent_guardian_signature_data_url,
    (v_participant.participant_type = 'child'),
    'activity',
    'signed',
    '1.0',
    now(),
    v_template.version,
    v_template.consent_text,
    'guest_checkin'
  )
  RETURNING id INTO v_consent_id;

  -- ---------- mark participant signed ----------
  UPDATE public.booking_participants
  SET consent_status = 'signed',
      consent_form_id = v_consent_id,
      customer_id = COALESCE(customer_id, v_customer_id),
      guardian_name = COALESCE(NULLIF(trim(p_parent_guardian_name), ''), guardian_name),
      guardian_relationship = COALESCE(NULLIF(trim(p_parent_guardian_relationship), ''), guardian_relationship)
  WHERE id = v_participant.id;

  -- ---------- cascade to the same person's other rows in the group ----------
  IF v_booking.group_id IS NOT NULL THEN
    UPDATE public.booking_participants
    SET consent_status = 'signed',
        consent_form_id = v_consent_id,
        customer_id = COALESCE(customer_id, v_customer_id),
        guardian_name = COALESCE(NULLIF(trim(p_parent_guardian_name), ''), guardian_name),
        guardian_relationship = COALESCE(NULLIF(trim(p_parent_guardian_relationship), ''), guardian_relationship)
    WHERE id <> v_participant.id
      AND full_name = v_participant.full_name
      AND participant_type = v_participant.participant_type
      AND booking_id IN (
        SELECT b2.id FROM public.bookings b2 WHERE b2.group_id = v_booking.group_id
      );
  END IF;

  RETURN json_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'participant_name', v_participant.full_name,
    'activity_name', (SELECT name FROM public.activities WHERE id = v_booking.activity_id),
    'is_minor', (v_participant.participant_type = 'child'),
    'message', 'Consent and liability waiver signed successfully.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- ================================================================
-- Permissions (anon-executable only, like the other walk-in RPCs)
-- ================================================================
REVOKE ALL ON FUNCTION public.submit_walkin_participant_consent(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_walkin_participant_consent(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_walkin_participant_consent(
  TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT) TO authenticated;

COMMIT;