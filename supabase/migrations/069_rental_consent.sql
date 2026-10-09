-- =============================================
-- Migration 069: Equipment Rental Consent & Liability
--
-- Reuses consent_forms (consent_type='equipment_rental') so rental waivers
-- share the token-keyed anon signing, the immutable signed record, and the
-- PDF pipeline. Each rental is linked to its consent via consent_forms.rental_id
-- and reuses the rental signing token, so the guest signs on the same
-- /rental/[token] link (no second link to send).
-- Returns are blocked until a signed equipment_rental consent exists.
-- =============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. SCHEMA: link consents to rentals; relax activity requirement
-- ---------------------------------------------------------------

ALTER TABLE public.consent_forms
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.equipment_rentals(id);

ALTER TABLE public.consent_forms
  ALTER COLUMN activity_id DROP NOT NULL;

ALTER TABLE public.consent_forms
  DROP CONSTRAINT IF EXISTS consent_forms_rental_or_activity_check;

ALTER TABLE public.consent_forms
  ADD CONSTRAINT consent_forms_rental_or_activity_check CHECK (
    (consent_type = 'equipment_rental' AND rental_id IS NOT NULL AND activity_id IS NULL)
    OR
    (consent_type <> 'equipment_rental' AND activity_id IS NOT NULL)
  );

-- Dedupe extended for the rental dimension. Booking consents keep their exact
-- prior uniqueness on (customer, booking, activity, type); rental consents are
-- deduped per rental.
DROP INDEX IF EXISTS public.idx_consent_forms_active_unique;
CREATE UNIQUE INDEX idx_consent_forms_active_unique
  ON public.consent_forms (
    customer_id,
    COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(rental_id, '00000000-0000-0000-0000-000000000000'::uuid),
    activity_id,
    consent_type
  )
  WHERE status IN ('pending', 'signed');

-- ---------------------------------------------------------------
-- 2. EQUIPMENT-RENTAL CONSENT TEMPLATE
-- ---------------------------------------------------------------
-- idx_consent_templates_active guarantees exactly one active template per
-- consent_type, so inserting with active=true is a rotation by construction.

INSERT INTO consent_templates (version, consent_type, title, consent_text, active)
VALUES (
  'equipment-rental-consent-v1',
  'equipment_rental',
  'Equipment Rental Liability Consent',
  E'THODDOO MARINE EXCURSION CENTRE — EQUIPMENT RENTAL LIABILITY CONSENT\n\nBy signing below, the guest renting equipment ("Guest") confirms agreement to the following:\n\n1. SAFETY ACKNOWLEDGEMENTS\n   - I confirm I have received and understood the safety instructions and briefing provided by Thoddoo Marine staff for this equipment.\n   - I confirm I will use the provided safety equipment (including any life jacket / buoyancy aid) as instructed while using the rented equipment.\n   - I acknowledge that using this equipment carries inherent risks including but not limited to injury, drowning, capsizing, and property damage. I voluntarily assume all risks associated with my use of the equipment.\n\n2. CONDITION & LIABILITY\n   - I acknowledge receipt of the equipment in the stated condition and agree to return it in that condition by the agreed time.\n   - I understand I may be liable for damage to or loss of the equipment while in my care, in addition to any applicable recovery, repair, or replacement charges.\n   - I agree to follow all safety and operating instructions and to stop and notify Thoddoo Marine staff immediately if the equipment faults or malfunctions.\n\n3. PARENT / GUARDIAN CONSENT (if the renter is under 18)\n   - A parent or legal guardian has reviewed and approved this consent form on behalf of the minor renter.\n\n4. GENERAL TERMS\n   - This form records my rental and liability acknowledgement. It does not constitute a blanket waiver of liability.\n   - Final liability wording should be reviewed under applicable Maldivian law and insurance requirements.\n\nNOTICE: This form should be reviewed under applicable Maldivian law.',
  true
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------
-- 3. RPC: staff creates (or reuses) the pending consent at checkout
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_rental_consent(p_rental_id uuid)
RETURNS JSON AS $$
DECLARE
  v_staff_id UUID;
  v_rental equipment_rentals%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_equipment equipment%ROWTYPE;
  v_existing consent_forms%ROWTYPE;
  v_id UUID;
BEGIN
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

  SELECT * INTO v_existing
  FROM consent_forms
  WHERE rental_id = v_rental.id
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('success', true, 'consent_id', v_existing.id, 'already_exists', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM consent_templates
    WHERE consent_type = 'equipment_rental' AND active = true
  ) THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active equipment rental consent template. Please contact staff.');
  END IF;

  SELECT * INTO v_customer FROM customers WHERE id = v_rental.customer_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'validation', 'message', 'Rental customer not found.');
  END IF;

  SELECT * INTO v_equipment FROM equipment WHERE id = v_rental.equipment_id;

  INSERT INTO consent_forms (
    booking_id,
    customer_id,
    rental_id,
    activity_id,
    activity_name,
    booking_ref,
    guest_name,
    consent_type,
    status,
    signing_token,
    signing_token_expires_at,
    is_minor,
    form_version
  )
  VALUES (
    v_rental.booking_id,
    v_rental.customer_id,
    v_rental.id,
    NULL,
    COALESCE(v_equipment.name, 'Equipment Rental'),
    NULL,
    v_customer.full_name,
    'equipment_rental',
    'pending',
    v_rental.signing_token,
    v_rental.signing_token_expires_at,
    false,
    '1.0'
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('success', true, 'consent_id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.create_rental_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rental_consent(uuid) TO authenticated;

-- ---------------------------------------------------------------
-- 4. RPC: guest-side fallback for legacy rentals already checked out.
--    Token possession is the auth factor (same unguessable link the guest
--    already holds) — creates a pending consent if one is missing.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_rental_consent_by_token(p_token text)
RETURNS JSON AS $$
DECLARE
  v_rental equipment_rentals%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_equipment equipment%ROWTYPE;
  v_existing consent_forms%ROWTYPE;
  v_id UUID;
BEGIN
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

  SELECT * INTO v_existing
  FROM consent_forms
  WHERE signing_token = p_token
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('success', true, 'consent_id', v_existing.id, 'already_exists', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM consent_templates
    WHERE consent_type = 'equipment_rental' AND active = true
  ) THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active equipment rental consent template. Please contact staff.');
  END IF;

  SELECT * INTO v_customer FROM customers WHERE id = v_rental.customer_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'validation', 'message', 'Rental customer not found.');
  END IF;

  SELECT * INTO v_equipment FROM equipment WHERE id = v_rental.equipment_id;

  INSERT INTO consent_forms (
    booking_id,
    customer_id,
    rental_id,
    activity_id,
    activity_name,
    booking_ref,
    guest_name,
    consent_type,
    status,
    signing_token,
    signing_token_expires_at,
    is_minor,
    form_version
  )
  VALUES (
    v_rental.booking_id,
    v_rental.customer_id,
    v_rental.id,
    NULL,
    COALESCE(v_equipment.name, 'Equipment Rental'),
    NULL,
    v_customer.full_name,
    'equipment_rental',
    'pending',
    v_rental.signing_token,
    v_rental.signing_token_expires_at,
    false,
    '1.0'
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('success', true, 'consent_id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.ensure_rental_consent_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_rental_consent_by_token(text) TO anon;

-- ---------------------------------------------------------------
-- 5. RPC: guest records minor status / date of birth before signing.
--    sign_consent_form reads consent_forms.is_minor and then requires
--    parent/guardian details, so this must run before the signature step.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_rental_consent_guest_info(
  p_token text,
  p_is_minor boolean DEFAULT false,
  p_date_of_birth date DEFAULT NULL
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

  IF v_row.consent_type != 'equipment_rental' OR v_row.rental_id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Form not found. Please confirm this is the correct rental consent link.');
  END IF;

  IF v_row.status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'This form has already been signed and cannot be modified.');
  END IF;

  IF p_is_minor AND p_date_of_birth IS NULL THEN
    RETURN json_build_object('error', 'validation', 'message', 'Date of birth is required for a minor renter.');
  END IF;

  IF p_date_of_birth IS NOT NULL AND p_date_of_birth > now()::date THEN
    RETURN json_build_object('error', 'validation', 'message', 'Date of birth cannot be in the future.');
  END IF;

  UPDATE consent_forms
  SET is_minor = p_is_minor,
      date_of_birth = p_date_of_birth
  WHERE id = v_row.id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.set_rental_consent_guest_info(text, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_rental_consent_guest_info(text, boolean, date) TO anon;

-- ---------------------------------------------------------------
-- 6. RETURN GATE: a rental cannot be returned until the guest consent
--    and liability form has been signed. Applies to the staff RPC path.
-- ---------------------------------------------------------------

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

  IF NOT EXISTS (
    SELECT 1 FROM consent_forms cf
    WHERE cf.rental_id = v_rental.id
      AND cf.consent_type = 'equipment_rental'
      AND cf.status = 'signed'
  ) THEN
    RETURN json_build_object('error', 'consent_required', 'message', 'Guest consent & liability form must be signed before this rental can be returned.');
  END IF;

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

-- ---------------------------------------------------------------
-- 7. PDF RENDERERS: surface consent_type so equipment-rental consents
--    render with rental titles. get_consent_for_pdf also gains a
--    watersports_staff branch for rental consents (no activity link).
-- ---------------------------------------------------------------

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

GRANT EXECUTE ON FUNCTION public.get_consent_pdf_by_token(text) TO anon;

-- ---------------------------------------------------------------
-- 8. ADMIN CONSENT PDF: staff lookup, rental-aware access branch
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_consent_for_pdf(p_consent_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_staff_id UUID;
  v_row consent_forms%ROWTYPE;
  v_staff_name TEXT;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception, or watersports_staff.';
  END IF;

  SELECT * INTO v_row FROM consent_forms WHERE id = p_consent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consent form not found.';
  END IF;

  IF v_row.status != 'signed' THEN
    RAISE EXCEPTION 'Only signed consent forms can be exported as PDF.';
  END IF;

  -- Watersports staff: booking access, rental consent access, or walk-in activity access
  IF v_role = 'watersports_staff' THEN
    IF v_row.booking_id IS NOT NULL THEN
      IF NOT staff_has_booking_access(v_row.booking_id) THEN
        RAISE EXCEPTION 'Access denied: you do not have access to this consent form.';
      END IF;
    ELSIF v_row.consent_type = 'equipment_rental' THEN
      NULL;
    ELSE
      IF v_row.activity_id IS NULL OR NOT staff_has_activity(v_row.activity_id) THEN
        RAISE EXCEPTION 'Access denied: you do not have access to this activity.';
      END IF;
    END IF;
  END IF;

  -- Get assisting staff name for staff-assisted signing
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
    'form_version', v_row.form_version,
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

REVOKE ALL ON FUNCTION public.get_consent_for_pdf(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_for_pdf(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_consent_for_pdf(UUID) TO authenticated;

COMMIT;