-- =============================================
-- Thoddoo Marine CMS – Security & RPC Migration 004
-- Fixes critical token security vulnerabilities
-- Adds signature columns for equipment_rentals
-- Creates SECURITY DEFINER RPC functions for guest access
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 1. ADD MISSING COLUMNS
-- =============================================

-- Guest signature column for equipment_rentals
ALTER TABLE equipment_rentals
  ADD COLUMN IF NOT EXISTS guest_signature_data_url TEXT;

-- Staff signature column for equipment_rentals
ALTER TABLE equipment_rentals
  ADD COLUMN IF NOT EXISTS staff_signature_data_url TEXT;

-- Guest signed timestamp for equipment_rentals
ALTER TABLE equipment_rentals
  ADD COLUMN IF NOT EXISTS guest_signed_at TIMESTAMPTZ;

-- Token expiry (7 days from creation by default)
ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS signing_token_expires_at TIMESTAMPTZ
  DEFAULT (now() + INTERVAL '7 days');

ALTER TABLE equipment_rentals
  ADD COLUMN IF NOT EXISTS signing_token_expires_at TIMESTAMPTZ
  DEFAULT (now() + INTERVAL '7 days');

-- =============================================
-- 2. REVOKE DANGEROUS ANONYMOUS ACCESS
-- =============================================

-- Remove the broken public policies that allowed
-- anonymous SELECT/UPDATE on ALL rows where
-- signing_token IS NOT NULL

-- consent_forms: remove dangerous public policies
DROP POLICY IF EXISTS consent_public_token_read ON consent_forms;
DROP POLICY IF EXISTS consent_public_token_update ON consent_forms;

-- equipment_rentals: remove dangerous public policies
DROP POLICY IF EXISTS rentals_public_token_read ON equipment_rentals;
DROP POLICY IF EXISTS rentals_public_token_update ON equipment_rentals;

-- Revoke direct anonymous access to sensitive tables
REVOKE ALL ON consent_forms FROM anon;
REVOKE ALL ON equipment_rentals FROM anon;

-- =============================================
-- 3. SECURITY DEFINER RPC FUNCTIONS
-- =============================================

-- Helper: validate signing token, check expiry and status
CREATE OR REPLACE FUNCTION public._validate_consent_token(p_token text)
RETURNS TABLE (
  p_id UUID,
  p_status consent_form_status,
  p_signed boolean
) AS $$
  SELECT id, status, (status = 'signed') AS signed
  FROM consent_forms
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

REVOKE ALL ON FUNCTION public._validate_consent_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._validate_consent_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public._validate_consent_token(text) TO authenticated;

-- Helper: validate rental signing token
CREATE OR REPLACE FUNCTION public._validate_rental_token(p_token text)
RETURNS TABLE (
  p_id UUID,
  p_status rental_status,
  p_returned boolean
) AS $$
  SELECT id, status, (status = 'returned') AS returned
  FROM equipment_rentals
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

REVOKE ALL ON FUNCTION public._validate_rental_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._validate_rental_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public._validate_rental_token(text) TO authenticated;

-- =============================================
-- 3a. CONSENT FORM: GUEST READ (returns minimal fields)
-- =============================================
CREATE OR REPLACE FUNCTION public.get_consent_form_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
BEGIN
  -- Null/empty token check
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_row
  FROM consent_forms
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Already signed: return minimal "already signed" response (no signature data)
  IF v_row.status = 'signed' THEN
    RETURN json_build_object(
      'id', v_row.id,
      'activity_name', v_row.activity_name,
      'guest_name', v_row.guest_name,
      'status', v_row.status,
      'signed_at', v_row.signed_at
    );
  END IF;

  -- Return only guest-visible fields (no internal IDs, customer_id, booking_id, tokens)
  -- No passport_number: consent form read doesn't need it
  RETURN json_build_object(
    'id', v_row.id,
    'activity_name', v_row.activity_name,
    'booking_ref', v_row.booking_ref,
    'guest_name', v_row.guest_name,
    'nationality', v_row.nationality,
    'date_of_birth', v_row.date_of_birth,
    'phone', v_row.phone,
    'hotel', v_row.hotel,
    'room_number', v_row.room_number,
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'swimming_ability', v_row.swimming_ability,
    'medical_conditions', v_row.medical_conditions,
    'allergies', v_row.allergies,
    'medications', v_row.medications,
    'recent_injuries', v_row.recent_injuries,
    'is_pregnant', v_row.is_pregnant,
    'safety_briefing_confirmed', v_row.safety_briefing_confirmed,
    'life_jacket_confirmed', v_row.life_jacket_confirmed,
    'risk_acknowledged', v_row.risk_acknowledged,
    'photo_consent', v_row.photo_consent,
    'is_minor', v_row.is_minor,
    'status', v_row.status,
    'signed_at', v_row.signed_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_consent_form_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_form_by_token(text) TO anon;

-- =============================================
-- 3b. CONSENT FORM: GUEST SIGN (updates via token)
-- =============================================
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
  p_parent_guardian_signature_data_url text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
BEGIN
  -- Null/empty token check
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

  -- Signed consent is immutable: reject if already signed
  IF v_row.status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'This form has already been signed and cannot be modified.');
  END IF;

  -- Reject if voided
  IF v_row.status = 'voided' THEN
    RETURN json_build_object('error', 'voided', 'message', 'This form has been voided.');
  END IF;

  -- Validate required safety acknowledgements
  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  -- Validate signature presence
  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Guest signature is required.');
  END IF;

  -- Validate signature size limit (1 MB)
  IF length(p_signature_data_url) > 1048576 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature data too large.');
  END IF;

  -- Validate signature format
  IF p_signature_data_url NOT LIKE 'data:image/%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Invalid signature format.');
  END IF;

  -- Validate minor consent if applicable
  IF v_row.is_minor AND (p_parent_guardian_name IS NULL OR p_parent_guardian_name = '') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
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
    signed_at = now()
  WHERE id = v_row.id;

  -- Return success without signature data
  RETURN json_build_object('success', true, 'message', 'Consent form signed successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.sign_consent_form(text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_consent_form(text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text, text, text, text) TO anon;

-- =============================================
-- 3c. RENTAL: GUEST READ
-- =============================================
CREATE OR REPLACE FUNCTION public.get_rental_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_rental equipment_rentals%ROWTYPE;
  v_equipment equipment%ROWTYPE;
BEGIN
  -- Null/empty token check
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_rental
  FROM equipment_rentals
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();

  IF NOT FOUND THEN
    -- Uniform error: don't distinguish not_found vs expired
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_equipment
  FROM equipment
  WHERE id = v_rental.equipment_id;

  -- Return guest-visible fields only
  RETURN json_build_object(
    'id', v_rental.id,
    'equipment', json_build_object(
      'name', v_equipment.name,
      'asset_number', v_equipment.asset_number,
      'category', v_equipment.category,
      'description', v_equipment.description
    ),
    'checkout_condition', v_rental.checkout_condition,
    'checked_out_at', v_rental.checked_out_at,
    'expected_return_at', v_rental.expected_return_at,
    'rental_charge_cents', v_rental.rental_charge_cents,
    'deposit_cents', v_rental.deposit_cents,
    'status', v_rental.status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_rental_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rental_by_token(text) TO anon;

-- =============================================
-- 3d. RENTAL: GUEST SIGN (acknowledgement)
-- =============================================
CREATE OR REPLACE FUNCTION public.sign_rental_agreement(
  p_token text,
  p_guest_signature_data_url text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_rental equipment_rentals%ROWTYPE;
BEGIN
  -- Null/empty token check
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_rental
  FROM equipment_rentals
  WHERE signing_token = p_token
    AND signing_token_expires_at > now();

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Rental agreement not found or link expired.');
  END IF;

  IF v_rental.status = 'returned' THEN
    RETURN json_build_object('error', 'already_returned', 'message', 'This equipment has already been returned.');
  END IF;

  -- Validate signature presence
  IF p_guest_signature_data_url IS NULL OR p_guest_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Guest signature is required.');
  END IF;

  -- Validate signature size limit (1 MB)
  IF length(p_guest_signature_data_url) > 1048576 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature data too large.');
  END IF;

  -- Validate signature format
  IF p_guest_signature_data_url NOT LIKE 'data:image/%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Invalid signature format.');
  END IF;

  UPDATE equipment_rentals SET
    guest_signature_data_url = p_guest_signature_data_url,
    guest_signed_at = now(),
    damage_notes = '[Guest signed ' || now()::text || ']'
  WHERE id = v_rental.id;

  RETURN json_build_object('success', true, 'message', 'Rental agreement signed successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.sign_rental_agreement(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_rental_agreement(text, text) TO anon;

-- =============================================
-- 3e. RENTAL: STAFF RETURN (requires auth)
-- =============================================
CREATE OR REPLACE FUNCTION public.complete_rental_return(
  p_rental_id uuid,
  p_return_condition text DEFAULT 'good',
  p_damage_notes text DEFAULT NULL,
  p_additional_charges_cents int DEFAULT 0,
  p_return_photo_url text DEFAULT NULL,
  p_staff_signature_data_url text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_rental equipment_rentals%ROWTYPE;
  v_staff_id UUID;
BEGIN
  -- Verify caller is authenticated staff
  v_staff_id := public.current_staff_id();
  IF v_staff_id IS NULL THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Staff authentication required.');
  END IF;

  SELECT * INTO v_rental
  FROM equipment_rentals
  WHERE id = p_rental_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Rental not found.');
  END IF;

  IF v_rental.status = 'returned' THEN
    RETURN json_build_object('error', 'already_returned', 'message', 'This rental has already been processed.');
  END IF;

  -- Validate staff signature if provided
  IF p_staff_signature_data_url IS NOT NULL AND p_staff_signature_data_url != '' THEN
    IF length(p_staff_signature_data_url) > 1048576 THEN
      RETURN json_build_object('error', 'validation', 'message', 'Staff signature data too large.');
    END IF;
    IF p_staff_signature_data_url NOT LIKE 'data:image/%' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Invalid staff signature format.');
    END IF;
  END IF;

  UPDATE equipment_rentals SET
    return_condition = p_return_condition::equipment_condition,
    damage_notes = p_damage_notes,
    additional_charges_cents = p_additional_charges_cents,
    return_photo_url = p_return_photo_url,
    staff_signature_data_url = p_staff_signature_data_url,
    returned_at = now(),
    returned_to = v_staff_id,
    status = 'returned'
  WHERE id = p_rental_id;

  RETURN json_build_object('success', true, 'message', 'Equipment return processed.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 4. REVOKE & GRANT EXECUTE PERMISSIONS
-- =============================================

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Guest functions (anon only)
GRANT EXECUTE ON FUNCTION public._validate_consent_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public._validate_rental_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_consent_form_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.sign_consent_form(text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_rental_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.sign_rental_agreement(text, text) TO anon;

-- Staff functions (authenticated only)
GRANT EXECUTE ON FUNCTION public._validate_consent_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._validate_rental_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rental_return(uuid, text, text, int, text, text) TO authenticated;
