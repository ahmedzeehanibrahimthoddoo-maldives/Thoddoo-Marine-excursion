-- =============================================
-- Migration 072: Compulsory Email + Guest Copies
--
-- A valid email is now required for every booking and every consent:
--   - consent_forms gains an `email` column (the authoritative guest email
--     used for the consent copy + rental receipt).
--   - update_rental_consent_details requires + stores the email (rental QR).
--   - set_consent_email(p_token, p_email) lets any pending consent row
--     capture the guest email before signing (activity + check-in consents).
--   - sign_consent_form now REFUSES to sign ANY consent type until a valid
--     email is present on the row (universal gate for participation).
--   - bookings INSERT/UPDATE is gated on the customer having a valid email.
--   - get_rental_receipt_by_token(...) exposes the rental receipt (invoice
--     data + payments) to the guest token so A return can be emailed.
-- PDF readers (get_consent_form_by_token / get_consent_pdf_by_token) also
-- surface `email` so the UI can prefill and the mailer can address copies.
-- =============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Schema: email on consent_forms + validation guard
-- ---------------------------------------------------------------

ALTER TABLE public.consent_forms
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Shared email validator (used for customers + consent_forms + RPC params)
CREATE OR REPLACE FUNCTION public.is_valid_email(p_email text)
RETURNS boolean AS $$
BEGIN
  RETURN NULLIF(trim(p_email), '') IS NOT NULL
     AND length(trim(p_email)) <= 254
     AND lower(trim(p_email)) ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- customers: email must be a valid address when present (NOT VALID so legacy
-- rows are untouched while NEW inserts/updates are enforced)
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_valid_email_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_valid_email_check
  CHECK (email IS NULL OR public.is_valid_email(email)) NOT VALID;

ALTER TABLE public.consent_forms
  DROP CONSTRAINT IF EXISTS consent_forms_valid_email_check;
ALTER TABLE public.consent_forms
  ADD CONSTRAINT consent_forms_valid_email_check
  CHECK (email IS NULL OR public.is_valid_email(email)) NOT VALID;

-- ---------------------------------------------------------------
-- 2. set_consent_email: pending-only, token-gated, syncs customers
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_consent_email(
  p_token text,
  p_email text
)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
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

  IF NOT public.is_valid_email(p_email) THEN
    RETURN json_build_object('error', 'validation', 'message', 'A valid email is required.');
  END IF;

  UPDATE consent_forms SET
    email = lower(trim(p_email))
  WHERE id = v_row.id;

  IF v_row.customer_id IS NOT NULL THEN
    UPDATE customers SET
      email = COALESCE(lower(trim(p_email)), email)
    WHERE id = v_row.customer_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.set_consent_email(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_consent_email(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.set_consent_email(text, text) TO authenticated;

-- ---------------------------------------------------------------
-- 3. update_rental_consent_details now requires + stores the email
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
  p_emergency_contact_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
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

  -- Compulsory valid email
  IF NOT public.is_valid_email(p_email) THEN
    RETURN json_build_object('error', 'validation', 'message', 'A valid email is required.');
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
    email = lower(trim(p_email)),
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
      emergency_contact_phone = COALESCE(NULLIF(trim(p_emergency_contact_phone), ''), emergency_contact_phone),
      email = COALESCE(lower(trim(p_email)), email)
    WHERE id = v_rental.customer_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.update_rental_consent_details(
  text, text, text, date, text, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_rental_consent_details(
  text, text, text, date, text, text, text, text, text, text, text
) TO anon;

-- ---------------------------------------------------------------
-- 4. sign_consent_form: universal valid-email gate (all consent types)
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

  -- Compulsory valid email: applies to EVERY consent type before signing
  IF v_row.email IS NULL OR NOT public.is_valid_email(v_row.email) THEN
    RETURN json_build_object('error', 'validation', 'message', 'A valid email is required before signing.');
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

-- ---------------------------------------------------------------
-- 5. Bookings gate: every booking needs a customer with a valid email
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._require_customer_email_for_booking()
RETURNS trigger AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT email INTO v_email FROM customers WHERE id = NEW.customer_id;
    IF v_email IS NULL OR NOT public.is_valid_email(v_email) THEN
      RAISE EXCEPTION 'A valid email is required for every booking. Please add the guest email to the customer record.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS require_customer_email_before_booking ON public.bookings;
CREATE TRIGGER require_customer_email_before_booking
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public._require_customer_email_for_booking();

-- ---------------------------------------------------------------
-- 6. Guest PDF readers surface `email` (prefill + mail addressing)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_consent_form_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
  v_template consent_templates%ROWTYPE;
BEGIN
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

  IF v_row.status = 'signed' THEN
    RETURN json_build_object(
      'id', v_row.id,
      'activity_name', v_row.activity_name,
      'guest_name', v_row.guest_name,
      'email', v_row.email,
      'status', v_row.status,
      'signed_at', v_row.signed_at
    );
  END IF;

  IF v_row.status = 'voided' THEN
    RETURN json_build_object(
      'id', v_row.id,
      'activity_name', v_row.activity_name,
      'guest_name', v_row.guest_name,
      'email', v_row.email,
      'status', v_row.status
    );
  END IF;

  -- Pending: load active template for guest display
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = COALESCE(v_row.consent_type, 'activity')
    AND active = true;

  RETURN json_build_object(
    'id', v_row.id,
    'activity_name', v_row.activity_name,
    'booking_ref', v_row.booking_ref,
    'guest_name', v_row.guest_name,
    'email', v_row.email,
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
    'consent_version', v_template.version,
    'consent_text', v_template.consent_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_consent_form_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_form_by_token(text) TO anon;

CREATE OR REPLACE FUNCTION public.get_consent_pdf_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_row consent_forms%ROWTYPE;
  v_staff_name TEXT;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_row
  FROM consent_forms
  WHERE signing_token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF v_row.status != 'signed' THEN
    RETURN json_build_object('error', 'not_signed');
  END IF;

  IF v_row.signed_by_staff_id IS NOT NULL THEN
    SELECT full_name INTO v_staff_name
    FROM staff_profiles
    WHERE id = v_row.signed_by_staff_id;
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'guest_name', v_row.guest_name,
    'activity_name', v_row.activity_name,
    'booking_ref', v_row.booking_ref,
    'nationality', v_row.nationality,
    'date_of_birth', v_row.date_of_birth,
    'phone', v_row.phone,
    'hotel', v_row.hotel,
    'room_number', v_row.room_number,
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'email', v_row.email,
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
    'parent_guardian_name', v_row.parent_guardian_name,
    'witness_name', v_row.witness_name,
    'signature_data_url', v_row.signature_data_url,
    'witness_signature_data_url', v_row.witness_signature_data_url,
    'parent_guardian_signature_data_url', v_row.parent_guardian_signature_data_url,
    'status', v_row.status,
    'consent_version', v_row.consent_version,
    'consent_text_snapshot', v_row.consent_text_snapshot,
    'signed_at', v_row.signed_at,
    'created_at', v_row.created_at,
    'signing_method', v_row.signing_method,
    'signed_by_staff_name', v_staff_name,
    'consent_type', v_row.consent_type
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_consent_pdf_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_pdf_by_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_consent_pdf_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_consent_pdf_by_token(text) TO authenticated;

-- ---------------------------------------------------------------
-- 7. Rental receipt by token (guest-visible; used to email the receipt)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_rental_receipt_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_rental equipment_rentals%ROWTYPE;
  v_equipment equipment%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_consent_email text;
  v_payments json;
  v_total_paid int;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT * INTO v_rental
  FROM equipment_rentals
  WHERE signing_token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Rental not found.');
  END IF;

  IF v_rental.status != 'returned' THEN
    RETURN json_build_object('error', 'not_returned', 'message', 'The rental has not been returned yet.');
  END IF;

  SELECT * INTO v_equipment
  FROM equipment
  WHERE id = v_rental.equipment_id;

  IF v_rental.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_rental.customer_id;
  END IF;

  SELECT email INTO v_consent_email
  FROM consent_forms
  WHERE rental_id = v_rental.id
    AND consent_type = 'equipment_rental'
    AND status = 'signed'
    AND email IS NOT NULL
  ORDER BY signed_at DESC
  LIMIT 1;

  SELECT COALESCE(json_agg(json_build_object(
    'id', p.id,
    'created_at', p.created_at,
    'method', p.method,
    'reference', p.reference,
    'amount_cents', p.amount_cents,
    'converted_amount_cents', p.converted_amount_cents,
    'currency', p.currency,
    'status', p.status
  )), '[]'::json) INTO v_payments
  FROM payments p
  WHERE p.rental_id = v_rental.id
  ORDER BY p.created_at DESC;

  SELECT COALESCE(sum(
    CASE WHEN p.status = 'completed'
      THEN COALESCE(p.converted_amount_cents, p.amount_cents, 0)
      ELSE 0 END
  ), 0) INTO v_total_paid
  FROM payments p
  WHERE p.rental_id = v_rental.id;

  RETURN json_build_object(
    'rental_id', v_rental.id,
    'checked_out_at', v_rental.checked_out_at,
    'expected_return_at', v_rental.expected_return_at,
    'returned_at', v_rental.returned_at,
    'rental_charge_cents', v_rental.rental_charge_cents,
    'deposit_cents', v_rental.deposit_cents,
    'additional_charges_cents', v_rental.additional_charges_cents,
    'currency', v_rental.currency,
    'payment_status', v_rental.payment_status,
    'equipment', json_build_object(
      'name', v_equipment.name,
      'asset_number', v_equipment.asset_number
    ),
    'customers', json_build_object(
      'full_name', v_customer.full_name,
      'phone', v_customer.phone,
      'hotel', v_customer.hotel,
      'room_number', v_customer.room_number
    ),
    'email', v_consent_email,
    'total_paid_cents', v_total_paid,
    'payments', v_payments
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_rental_receipt_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rental_receipt_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_rental_receipt_by_token(text) TO authenticated;

COMMIT;