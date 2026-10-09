-- =============================================
-- Migration 070: Rental Waiver — Compulsory Guest Details
--
-- The rental QSo path now captures the guest's full identity, stay, and
-- emergency details on the signing page (mirroring the walk-in consent flow):
--   update_rental_consent_details(...) lets the guest fill all compulsory
--   details before signing, computes is_minor from the date of birth, writes
--   the consent row, and syncs the customers record.
--   sign_consent_form gains a rental-only guard: an equipment_rental consent
--   cannot be signed until the compulsory details are present.
-- Replaces set_rental_consent_guest_info (dropped — superseded).
-- =============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. DROP the superseded pre-sign RPC (shipped in 069; unused)
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.set_rental_consent_guest_info(text, boolean, date);

-- ---------------------------------------------------------------
-- 2. GUEST DETAILS RPC (anon, token-gated, pending only)
--    Writes compulsory details, derives minor status from DOB, syncs customers.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_rental_consent_details(
  p_token text,
  p_guest_name text DEFAULT NULL,
  p_nationality text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_passport_number text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_hotel text DEFAULT NULL,
  p_room_number text DEFAULT NULL,
  p_emergency_contact_name text DEFAULT NULL,
  p_emergency_contact_phone text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
  v_rental equipment_rentals%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_row
  FROM consent_forms
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Form not found or link expired.');
  END IF;

  IF v_row.consent_type != 'equipment_rental' OR v_row.rental_id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Form not found. Please confirm this is the correct rental consent link.');
  END IF;

  IF v_row.status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'This form has already been signed and cannot be modified.');
  END IF;

  -- Compulsory identification + stay + emergency details
  IF NULLIF(trim(p_guest_name), '') IS NULL
     OR NULLIF(trim(p_nationality), '') IS NULL
     OR p_date_of_birth IS NULL
     OR NULLIF(trim(p_phone), '') IS NULL
     OR NULLIF(trim(p_hotel), '') IS NULL
     OR NULLIF(trim(p_emergency_contact_name), '') IS NULL
     OR NULLIF(trim(p_emergency_contact_phone), '') IS NULL THEN
    RETURN json_build_object('error', 'validation', 'message', 'All compulsory guest details must be completed: full name, nationality, date of birth, phone, hotel, and emergency contact.');
  END IF;

  IF p_date_of_birth > now()::date THEN
    RETURN json_build_object('error', 'validation', 'message', 'Date of birth cannot be in the future.');
  END IF;

  SELECT * INTO v_rental FROM equipment_rentals WHERE id = v_row.rental_id;

  UPDATE consent_forms SET
    guest_name = trim(p_guest_name),
    nationality = NULLIF(trim(p_nationality), ''),
    date_of_birth = p_date_of_birth,
    passport_number = NULLIF(trim(p_passport_number), ''),
    phone = NULLIF(trim(p_phone), ''),
    hotel = NULLIF(trim(p_hotel), ''),
    room_number = NULLIF(trim(p_room_number), ''),
    emergency_contact_name = NULLIF(trim(p_emergency_contact_name), ''),
    emergency_contact_phone = NULLIF(trim(p_emergency_contact_phone), ''),
    is_minor = (date_part('year', age(now(), p_date_of_birth)) < 18)
  WHERE id = v_row.id;

  -- Sync the customer record (COALESCE — never clobber existing data)
  IF FOUND AND v_rental.customer_id IS NOT NULL THEN
    UPDATE customers SET
      full_name = NULLIF(trim(p_guest_name), ''),
      nationality = COALESCE(NULLIF(trim(p_nationality), ''), nationality),
      date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
      passport_number = COALESCE(NULLIF(trim(p_passport_number), ''), passport_number),
      phone = COALESCE(NULLIF(trim(p_phone), ''), phone),
      hotel = COALESCE(NULLIF(trim(p_hotel), ''), hotel),
      room_number = COALESCE(NULLIF(trim(p_room_number), ''), room_number),
      emergency_contact_name = COALESCE(NULLIF(trim(p_emergency_contact_name), ''), emergency_contact_name),
      emergency_contact_phone = COALESCE(NULLIF(trim(p_emergency_contact_phone), ''), emergency_contact_phone)
    WHERE id = v_rental.customer_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.update_rental_consent_details(
  text, text, text, date, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_rental_consent_details(
  text, text, text, date, text, text, text, text, text, text
) TO anon;

-- ---------------------------------------------------------------
-- 3. RENTAL-ONLY COMPULSORY GUARD INSIDE sign_consent_form
--    An equipment_rental consent cannot be signed until the compulsory
--    details are present on the row (set by update_rental_consent_details).
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sign_consent_form(
  p_token text,
  p_swimming_ability text DEFAULT NULL,
  p_medical_conditions text DEFAULT NULL,
  p_allergies text DEFAULT NULL,
  p_medications text DEFAULT NULL,
  p_recent_injuries text DEFAULT NULL,
  p_is_pregnant boolean DEFAULT false,
  p_safety_briefing_confirmed boolean DEFAULT false,
  p_life_jacket_confirmed boolean DEFAULT false,
  p_risk_acknowledged boolean DEFAULT false,
  p_photo_consent boolean DEFAULT false,
  p_signature_data_url text DEFAULT NULL,
  p_witness_name text DEFAULT NULL,
  p_witness_signature_data_url text DEFAULT NULL,
  p_parent_guardian_name text DEFAULT NULL,
  p_parent_guardian_signature_data_url text DEFAULT NULL,
  p_expected_consent_version text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
  v_template consent_templates%ROWTYPE;
  v_payload text;
  v_sig_bytes int;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_row
  FROM consent_forms
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Form not found or link expired.');
  END IF;

  IF v_row.status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'This form has already been signed and cannot be modified.');
  END IF;

  IF v_row.status = 'voided' THEN
    RETURN json_build_object('error', 'voided', 'message', 'This form has been voided.');
  END IF;

  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  -- Rental waivers require the compulsory guest details to be completed first
  IF v_row.consent_type = 'equipment_rental' THEN
    IF NULLIF(trim(v_row.nationality), '') IS NULL
       OR v_row.date_of_birth IS NULL
       OR NULLIF(trim(v_row.phone), '') IS NULL
       OR NULLIF(trim(v_row.hotel), '') IS NULL
       OR NULLIF(trim(v_row.emergency_contact_name), '') IS NULL
       OR NULLIF(trim(v_row.emergency_contact_phone), '') IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'All compulsory guest details must be completed before signing.');
    END IF;
  END IF;

  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Guest signature is required.');
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

  IF v_row.is_minor AND (p_parent_guardian_name IS NULL OR p_parent_guardian_name = '') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
  END IF;

  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = COALESCE(v_row.consent_type, 'activity')
    AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  IF p_expected_consent_version IS NOT NULL
     AND p_expected_consent_version != v_template.version THEN
    RETURN json_build_object(
      'error', 'terms_updated_refresh_required',
      'message', 'The consent terms have been updated. Please refresh the page and review the current version before signing.'
    );
  END IF;

  UPDATE consent_forms SET
    swimming_ability = p_swimming_ability,
    medical_conditions = p_medical_conditions,
    allergies = p_allergies,
    medications = p_medications,
    recent_injuries = p_recent_injuries,
    is_pregnant = p_is_pregnant,
    safety_briefing_confirmed = p_safety_briefing_confirmed,
    life_jacket_confirmed = p_life_jacket_confirmed,
    risk_acknowledged = p_risk_acknowledged,
    photo_consent = p_photo_consent,
    signature_data_url = p_signature_data_url,
    witness_name = p_witness_name,
    witness_signature_data_url = p_witness_signature_data_url,
    parent_guardian_name = p_parent_guardian_name,
    parent_guardian_signature_data_url = p_parent_guardian_signature_data_url,
    status = 'signed',
    signed_at = now(),
    consent_version = v_template.version,
    consent_text_snapshot = v_template.consent_text,
    signing_method = 'guest_token',
    signed_by_staff_id = NULL
  WHERE id = v_row.id;

  RETURN json_build_object('success', true, 'message', 'Consent form signed successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) TO anon;
GRANT EXECUTE ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) TO authenticated;

COMMIT;