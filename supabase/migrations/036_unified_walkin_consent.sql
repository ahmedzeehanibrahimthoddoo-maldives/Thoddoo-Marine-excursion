-- =============================================
-- 036: UNIFIED WALK-IN BOOKING — CREATE + SIGN CONSENT
-- =============================================
-- The walk-in QR flow was two separate sessions: first the guest booked
-- (submit_public_booking, source walk_in, pending/unpaid), then staff had to
-- run a separate consent QR. This RPC lets a guest create and sign their
-- activity consent + liability waiver immediately after booking, in the same
-- session, while the booking is still pending/unpaid.
--
-- Security properties (mirror migration 009 / 010):
--   - ownership verified against the booking's stored phone
--   - active server template required for the text snapshot
--   - stale-template protection via p_expected_consent_version
--   - all three safety acknowledgements required
--   - PNG/JPEG signature only, 512 KB decoded limit (pre-decode length check)
--   - minors require parent/guardian name + signature
--   - one signed activity consent per booking (idempotent: re-submit returns success)
--   - signing_method = 'guest_checkin' (allowed by migration 015 constraint)
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_walkin_consent(
  p_booking_ref                    TEXT,
  p_phone                          TEXT,
  p_nationality                    TEXT DEFAULT NULL,
  p_date_of_birth                  DATE DEFAULT NULL,
  p_passport_number                TEXT DEFAULT NULL,
  p_emergency_contact_name         TEXT DEFAULT NULL,
  p_emergency_contact_phone        TEXT DEFAULT NULL,
  p_swimming_ability               TEXT DEFAULT NULL,
  p_medical_conditions             TEXT DEFAULT NULL,
  p_allergies                      TEXT DEFAULT NULL,
  p_medications                    TEXT DEFAULT NULL,
  p_recent_injuries                TEXT DEFAULT NULL,
  p_is_pregnant                    BOOLEAN DEFAULT FALSE,
  p_safety_briefing_confirmed      BOOLEAN DEFAULT FALSE,
  p_life_jacket_confirmed          BOOLEAN DEFAULT FALSE,
  p_risk_acknowledged              BOOLEAN DEFAULT FALSE,
  p_photo_consent                  BOOLEAN DEFAULT FALSE,
  p_signature_data_url             TEXT DEFAULT NULL,
  p_witness_name                   TEXT DEFAULT NULL,
  p_witness_signature_data_url     TEXT DEFAULT NULL,
  p_parent_guardian_name           TEXT DEFAULT NULL,
  p_parent_guardian_signature_data_url TEXT DEFAULT NULL,
  p_expected_consent_version       TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_booking    RECORD;
  v_customer   RECORD;
  v_template   RECORD;
  v_consent_id UUID;
  v_payload    TEXT;
  v_sig_bytes  INT;
  v_is_minor   BOOLEAN := FALSE;
  v_phone_norm TEXT;
BEGIN
  -- ---------- ownership + booking validation ----------
  IF p_booking_ref IS NULL OR p_booking_ref = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Booking reference is required.');
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Phone number is required.');
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.booking_ref = p_booking_ref;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Booking not found. Please check your reference.');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN json_build_object('error', 'validation', 'message', 'This booking has been cancelled.');
  END IF;

  SELECT c.* INTO v_customer
  FROM public.customers c
  WHERE c.id = v_booking.customer_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Customer record not found.');
  END IF;

  -- Phone match: compare normalized digits; fall back to last 4 digits.
  v_phone_norm := regexp_replace(trim(p_phone), '[^0-9]', '', 'g');
  IF (
    (v_customer.phone IS NULL)
    OR (
      regexp_replace(v_customer.phone, '[^0-9]', '', 'g') <> v_phone_norm
      AND right(regexp_replace(v_customer.phone, '[^0-9]', '', 'g'), 4) <> right(v_phone_norm, 4)
    )
  ) THEN
    RETURN json_build_object('error', 'verification_failed', 'message', 'The phone number does not match this booking.');
  END IF;

  -- ---------- idempotency: already signed ----------
  IF EXISTS (
    SELECT 1 FROM public.consent_forms cf
    WHERE cf.booking_id = v_booking.id
      AND cf.consent_type = 'activity'
      AND cf.status = 'signed'
  ) THEN
    SELECT id INTO v_consent_id
    FROM public.consent_forms cf
    WHERE cf.booking_id = v_booking.id
      AND cf.consent_type = 'activity'
      AND cf.status = 'signed'
    ORDER BY cf.created_at DESC
    LIMIT 1;
    RETURN json_build_object('success', true, 'already_signed', true, 'consent_id', v_consent_id);
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
  IF p_date_of_birth IS NOT NULL THEN
    v_is_minor := (
      (CURRENT_DATE - p_date_of_birth) < 6574  -- < 18 years (365.2-day years)
    );
  END IF;

  IF v_is_minor AND (p_parent_guardian_name IS NULL OR p_parent_guardian_name = '') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
  END IF;

  IF v_is_minor AND (p_parent_guardian_signature_data_url IS NULL OR p_parent_guardian_signature_data_url = '') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian signature is required for minors.');
  END IF;

  -- ---------- active template (migration 009 protection) ----------
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

  -- ---------- persist captured guest details on the customer record ----------
  UPDATE public.customers SET
    nationality             = COALESCE(NULLIF(trim(p_nationality), ''), nationality),
    date_of_birth           = COALESCE(p_date_of_birth, date_of_birth),
    passport_number         = COALESCE(NULLIF(trim(p_passport_number), ''), passport_number),
    emergency_contact_name  = COALESCE(NULLIF(trim(p_emergency_contact_name), ''), emergency_contact_name),
    emergency_contact_phone = COALESCE(NULLIF(trim(p_emergency_contact_phone), ''), emergency_contact_phone)
  WHERE id = v_customer.id;

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
    v_customer.id,
    v_booking.activity_id,
    (SELECT name FROM public.activities WHERE id = v_booking.activity_id),
    v_booking.booking_ref,
    v_customer.full_name,
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
    NULLIF(trim(p_parent_guardian_name), ''),
    p_parent_guardian_signature_data_url,
    v_is_minor,
    'activity',
    'signed',
    '1.0',
    now(),
    v_template.version,
    v_template.consent_text,
    'guest_checkin'
  )
  RETURNING id INTO v_consent_id;

  RETURN json_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'booking_ref', v_booking.booking_ref,
    'guest_name', v_customer.full_name,
    'activity_name', (SELECT name FROM public.activities WHERE id = v_booking.activity_id),
    'is_minor', v_is_minor,
    'message', 'Consent and liability waiver signed successfully.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_walkin_consent(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_walkin_consent(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_walkin_consent(TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

COMMIT;