-- =============================================
-- 027: GRACEFUL DUPLICATE GUARD IN submit_checkin_consent
-- =============================================
-- A confirmed+paid booking gets an auto-offered
-- booking-level consent. If a guest then signs via the
-- check-in QR flow, INSERT collides with the unique
-- active-consent index and raises a raw 23505.
-- Add a friendly pre-check matching existing
-- pending/signed consent for the same
-- customer + booking + activity + type.
-- =============================================

BEGIN;

DROP FUNCTION IF EXISTS public.submit_checkin_consent(text, text, text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text, text, text, text, text);

CREATE FUNCTION public.submit_checkin_consent(
  p_verification_token text,
  p_swimming_ability text,
  p_medical_conditions text,
  p_allergies text,
  p_medications text,
  p_recent_injuries text,
  p_is_pregnant boolean,
  p_safety_briefing_confirmed boolean,
  p_life_jacket_confirmed boolean,
  p_risk_acknowledged boolean,
  p_photo_consent boolean,
  p_signature_data_url text,
  p_witness_name text,
  p_witness_signature_data_url text,
  p_parent_guardian_name text,
  p_parent_guardian_relationship text,
  p_parent_guardian_signature_data_url text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_vt_hash TEXT;
  v_vt consent_checkin_verification_tokens%ROWTYPE;
  v_session consent_checkin_sessions%ROWTYPE;
  v_participant booking_participants%ROWTYPE;
  v_template consent_templates%ROWTYPE;
  v_consent_id UUID;
  v_customer_id UUID;
  v_payload TEXT;
  v_sig_bytes INT;
BEGIN
  IF p_verification_token IS NULL OR p_verification_token = '' THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid session.');
  END IF;

  v_vt_hash := public._hash_token(p_verification_token);

  SELECT * INTO v_vt
  FROM consent_checkin_verification_tokens
  WHERE token_hash = v_vt_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session expired or invalid.');
  END IF;

  IF v_vt.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'Session expired. Please scan the QR code again.');
  END IF;

  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'Consent already submitted for this participant.');
  END IF;

  -- Lock verification token row to prevent concurrent submissions
  PERFORM pg_advisory_xact_lock(hashtext(p_verification_token));

  -- Re-check used_at under advisory lock
  SELECT * INTO v_vt FROM consent_checkin_verification_tokens WHERE token_hash = v_vt_hash;
  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'Consent already submitted for this participant.');
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = v_vt.session_id;
  SELECT * INTO v_participant FROM booking_participants WHERE id = v_vt.participant_id;

  -- Validate required safety fields
  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  -- Validate signature present
  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature is required.');
  END IF;

  -- Validate signature format (PNG or JPEG only)
  IF p_signature_data_url NOT LIKE 'data:image/png;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpeg;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpg;base64,%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature must be a PNG or JPEG data URL.');
  END IF;

  -- Pre-decode size limit (699,050 base64 chars max)
  v_payload := split_part(p_signature_data_url, ',', 2);
  IF length(v_payload) > 699050 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size.');
  END IF;

  BEGIN
    v_sig_bytes := length(decode(v_payload, 'base64'));
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature contains invalid data.');
  END;

  -- Decoded byte limit (524,288 bytes)
  IF v_sig_bytes > 524288 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size.');
  END IF;

  -- Minor requires guardian name, relationship, and signature
  IF v_participant.participant_type = 'child' THEN
    IF p_parent_guardian_name IS NULL OR p_parent_guardian_name = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
    END IF;
    IF p_parent_guardian_relationship IS NULL OR p_parent_guardian_relationship = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Guardian relationship is required for minors.');
    END IF;
    IF p_parent_guardian_signature_data_url IS NULL OR p_parent_guardian_signature_data_url = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian signature is required for minors.');
    END IF;
  END IF;

  -- Load active consent template (migration 009 protection)
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = 'activity' AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  -- Check for duplicate individual consent (same participant + activity already signed)
  IF v_participant.consent_status = 'signed' THEN
    RETURN json_build_object('error', 'duplicate', 'message', 'Consent already submitted for this activity.');
  END IF;

  -- Create customer for walk-ins if needed
  IF v_participant.customer_id IS NULL THEN
    INSERT INTO customers (full_name)
    VALUES (v_participant.full_name)
    RETURNING id INTO v_customer_id;
    UPDATE booking_participants SET customer_id = v_customer_id WHERE id = v_participant.id;
  ELSE
    v_customer_id := v_participant.customer_id;
  END IF;

  -- Graceful guard: an active (pending/signed) booking-level consent already
  -- exists for this customer + booking + activity + type.
  --   * signed  -> duplicate, do not create another (guest already signed)
  --   * pending -> the auto-offered representative; the guest is signing it now
  --                via the QR flow, so VOID it (superseded) and create the
  --                participant-level consent instead of raising 23505.
  PERFORM 1 FROM consent_forms c
  WHERE c.customer_id = v_customer_id
    AND c.activity_id = v_session.activity_id
    AND c.consent_type = 'activity'
    AND COALESCE(c.booking_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_session.booking_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND c.status = 'signed'
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object('error', 'duplicate', 'message', 'Consent already signed for this activity by this guest.');
  END IF;

  UPDATE consent_forms
  SET status = 'voided',
      void_reason = 'Superseded by QR check-in consent',
      voided_at = now()
  WHERE customer_id = v_customer_id
    AND activity_id = v_session.activity_id
    AND consent_type = 'activity'
    AND COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_session.booking_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND status = 'pending';

  -- Create and sign consent form with server template snapshot
  INSERT INTO consent_forms (
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
    status,
    signed_at,
    consent_version,
    consent_text_snapshot,
    signing_method
  )
  SELECT
    v_session.booking_id,
    v_customer_id,
    v_session.activity_id,
    (SELECT name FROM activities WHERE id = v_session.activity_id),
    (SELECT booking_ref FROM bookings WHERE id = v_session.booking_id),
    v_participant.full_name,
    (SELECT nationality FROM customers WHERE id = v_customer_id),
    (SELECT date_of_birth FROM customers WHERE id = v_customer_id),
    (SELECT passport_number FROM customers WHERE id = v_customer_id),
    (SELECT phone FROM customers WHERE id = v_customer_id),
    (SELECT hotel FROM customers WHERE id = v_customer_id),
    (SELECT room_number FROM customers WHERE id = v_customer_id),
    (SELECT emergency_contact_name FROM customers WHERE id = v_customer_id),
    (SELECT emergency_contact_phone FROM customers WHERE id = v_customer_id),
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
    p_witness_name,
    p_witness_signature_data_url,
    p_parent_guardian_name,
    p_parent_guardian_signature_data_url,
    v_participant.participant_type = 'child',
    'signed',
    now(),
    v_template.version,
    v_template.consent_text,
    'guest_checkin'
  RETURNING id INTO v_consent_id;

  -- Update participant consent status
  UPDATE booking_participants
  SET consent_status = 'signed', consent_form_id = v_consent_id,
      guardian_name = COALESCE(p_parent_guardian_name, guardian_name),
      guardian_relationship = COALESCE(p_parent_guardian_relationship, guardian_relationship)
  WHERE id = v_participant.id;

  -- Mark verification token as used (consumed atomically)
  UPDATE consent_checkin_verification_tokens
  SET used_at = now()
  WHERE id = v_vt.id;

  RETURN json_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'guest_name', v_participant.full_name,
    'activity_name', (SELECT name FROM activities WHERE id = v_session.activity_id),
    'message', 'Consent form signed successfully.'
  );
END;
$$;

COMMIT;