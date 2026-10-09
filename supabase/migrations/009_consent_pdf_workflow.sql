-- =============================================
-- Migration 009: Consent PDF Workflow + Security
-- =============================================
-- consent_templates table (migration-managed, no direct writes)
-- Drop ALL obsolete sign_consent_form overloads
-- Canonical 17-param sign_consent_form (guest, anon)
-- Canonical 17-param staff_sign_consent (staff, authenticated)
-- Stale template protection via p_expected_consent_version
-- Staff-assisted signing audit (signing_method, signed_by_staff_id)
-- Fully immutable signed records + template immutability
-- get_active_consent_template (anon + authenticated)
-- get_consent_for_pdf (authenticated, walk-in aware)
-- Pre-decode signature size limit
-- No signed_ip (unreliable in current architecture)
-- Does NOT modify migrations 001–008.
-- Migration 008 is separate and must be applied first.
-- =============================================

BEGIN;

-- =============================================
-- 1. CONSENT TEMPLATES TABLE
-- =============================================
-- Migration-managed only. No direct writes by any role.
-- Templates are created/activated through migrations.
-- Reads through get_active_consent_template RPC only.

CREATE TABLE IF NOT EXISTS consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT UNIQUE NOT NULL,
  consent_type TEXT NOT NULL DEFAULT 'activity',
  title TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one active template per consent_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_templates_active
  ON consent_templates (consent_type)
  WHERE active = true;

-- Revoke all direct access: no role can INSERT/UPDATE/DELETE templates
-- except through future owner/manager-only RPCs.
-- Templates are read-only for all roles; reads go through the RPC.
REVOKE ALL ON consent_templates FROM PUBLIC;
REVOKE ALL ON consent_templates FROM anon;
REVOKE ALL ON consent_templates FROM authenticated;

-- =============================================
-- 2. TEMPLATE IMMUTABILITY ENFORCEMENT
-- =============================================
-- Never modify or delete a template referenced by a signed consent.
-- Prevents retroactive alteration of accepted legal text.

CREATE OR REPLACE FUNCTION public.prevent_template_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM consent_forms cf
    WHERE cf.consent_version = OLD.version
      AND cf.status = 'signed'
  ) THEN
    RAISE EXCEPTION 'Cannot modify or delete consent template "%": referenced by signed consent(s).', OLD.version;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_template_tampering ON consent_templates;
CREATE TRIGGER trg_prevent_template_tampering
  BEFORE UPDATE OR DELETE ON consent_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_template_tampering();

-- =============================================
-- 3. SEED: activity-consent-v1
-- =============================================

INSERT INTO consent_templates (version, consent_type, title, consent_text, active)
VALUES (
  'activity-consent-v1',
  'activity',
  'Activity Participation Consent',
  E'THODDOO MARINE EXCURSION CENTRE — ACTIVITY PARTICIPATION CONSENT\n\nBy signing this consent form, the participant ("Guest") confirms agreement to the following:\n\n1. SAFETY ACKNOWLEDGEMENTS\n   - I confirm I have received and understood the safety briefing for this activity.\n   - I confirm I will wear the provided life jacket / safety equipment at all times during the activity.\n   - I acknowledge that water sports activities carry inherent risks including but not limited to drowning, injury, and property damage. I voluntarily assume all risks associated with my participation.\n\n2. MEDICAL DISCLOSURE\n   - I have disclosed all known medical conditions, allergies, medications, and recent injuries or surgeries.\n   - I confirm whether I am currently pregnant.\n   - I understand that failure to disclose medical information may increase risk to myself and others.\n\n3. PHOTO / VIDEO CONSENT\n   - I consent to the use of photographs or video recordings of me during this activity for Thoddoo Marine Excursion promotional and social media purposes (if checked).\n\n4. PARENT / GUARDIAN CONSENT (if participant is under 18)\n   - A parent or legal guardian has reviewed and approved this consent form on behalf of the minor participant.\n\n5. GENERAL TERMS\n   - This form records my participation agreement for the stated activity. It does not constitute a blanket waiver of liability.\n   - Final liability wording should be reviewed under applicable Maldivian law and insurance requirements.\n\nNOTICE: This form should be reviewed under applicable Maldivian law.',
  true
)
ON CONFLICT (version) DO NOTHING;

-- Template activation/change is migration-managed only.
-- Future template-management RPCs (owner/manager-only) will write
-- audit_log entries. Deferred until management UI is implemented.

-- =============================================
-- 4. CONSENT EVIDENCE COLUMNS
-- =============================================

ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS consent_version TEXT;

ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS consent_text_snapshot TEXT;

ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS signing_method TEXT
  DEFAULT 'guest_token';

ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS signed_by_staff_id UUID
  REFERENCES staff_profiles(id);

-- Constrain signing_method to allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_forms_signing_method_check'
  ) THEN
    ALTER TABLE consent_forms
      ADD CONSTRAINT consent_forms_signing_method_check
      CHECK (signing_method IN ('guest_token', 'staff_assisted'));
  END IF;
END $$;

-- =============================================
-- 5. IMMUTABILITY: fully protect signed records
-- =============================================
-- When status = 'signed': ALL columns are immutable.
-- No status change, no evidence modification, no re-signing.

CREATE OR REPLACE FUNCTION public.prevent_signed_consent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'Signed consent forms are immutable and cannot be modified.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_signed_consent_modification ON consent_forms;
CREATE TRIGGER trg_prevent_signed_consent_modification
  BEFORE UPDATE ON consent_forms
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_signed_consent_modification();

-- =============================================
-- 6. RPC: get_active_consent_template
-- =============================================
-- Returns the active template for consent_type.
-- Granted to anon (guest) and authenticated (CMS staff preview).
-- No table management; reads through RPC only.

CREATE OR REPLACE FUNCTION public.get_active_consent_template(
  p_consent_type TEXT DEFAULT 'activity'
)
RETURNS JSON AS $$
DECLARE
  v_template consent_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = p_consent_type
    AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'No active consent template.');
  END IF;

  RETURN json_build_object(
    'version', v_template.version,
    'title', v_template.title,
    'consent_text', v_template.consent_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_active_consent_template(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_consent_template(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_consent_template(text) TO authenticated;

-- =============================================
-- 7. DROP ALL OLD sign_consent_form OVERLOADS
-- =============================================
-- Migration 004 created (16 params)
-- Previous migration 009 created (18 params)
-- Both must be dropped to leave exactly one canonical overload.

DROP FUNCTION IF EXISTS public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text
);

DROP FUNCTION IF EXISTS public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text, text
);

-- =============================================
-- 8. CANONICAL sign_consent_form (GUEST, anon)
-- =============================================
-- 17 parameters: p_token + 15 data + p_expected_consent_version
-- Browser submits p_token + data + the version it displayed.
-- Server loads active template, compares version, stores DB text.
-- Browser never provides consent_text_snapshot, signing_method, or signed_by_staff_id.
-- Pre-decode base64 length check before decode().
-- Granted to anon only.

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

  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Guest signature is required.');
  END IF;

  IF p_signature_data_url NOT LIKE 'data:image/png;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpeg;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpg;base64,%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature must be a PNG or JPEG data URL.');
  END IF;

  -- Pre-decode size limit: base64 payload length for 524,288 decoded bytes
  v_payload := split_part(p_signature_data_url, ',', 2);
  IF length(v_payload) > 699050 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size of 512 KB.');
  END IF;

  -- Decode and enforce decoded byte limit
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

  -- Server-controlled: load active template from database
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = COALESCE(v_row.consent_type, 'activity')
    AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  -- Stale template protection
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

-- Grant to anon only (guest signing)
REVOKE ALL ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sign_consent_form(
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) TO anon;

-- =============================================
-- 9. CANONICAL staff_sign_consent (STAFF, authenticated)
-- =============================================
-- 17 parameters: p_consent_id + 15 data + p_expected_consent_version
-- Authenticated staff signing with role check.
-- Forces signing_method = 'staff_assisted', signed_by_staff_id = current_staff_id().
-- Same template lookup, version comparison, replay protection
-- and immutable evidence rules as guest signing.
-- Pre-decode base64 length check before decode().

CREATE OR REPLACE FUNCTION public.staff_sign_consent(
  p_consent_id UUID,
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
  v_role TEXT;
  v_staff_id UUID;
  v_row consent_forms%ROWTYPE;
  v_template consent_templates%ROWTYPE;
  v_payload text;
  v_sig_bytes int;
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
    RETURN json_build_object('error', 'not_found', 'message', 'Consent form not found.');
  END IF;

  IF v_row.status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'This form has already been signed and cannot be modified.');
  END IF;

  IF v_row.status = 'voided' THEN
    RETURN json_build_object('error', 'voided', 'message', 'This form has been voided.');
  END IF;

  -- Watersports staff: booking access OR walk-in activity access
  IF v_role = 'watersports_staff' THEN
    IF v_row.booking_id IS NOT NULL THEN
      IF NOT staff_has_booking_access(v_row.booking_id) THEN
        RAISE EXCEPTION 'Access denied: you do not have access to this consent form.';
      END IF;
    ELSE
      IF v_row.activity_id IS NULL OR NOT staff_has_activity(v_row.activity_id) THEN
        RAISE EXCEPTION 'Access denied: you do not have access to this activity.';
      END IF;
    END IF;
  END IF;

  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Guest signature is required.');
  END IF;

  IF p_signature_data_url NOT LIKE 'data:image/png;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpeg;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpg;base64,%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature must be a PNG or JPEG data URL.');
  END IF;

  -- Pre-decode size limit
  v_payload := split_part(p_signature_data_url, ',', 2);
  IF length(v_payload) > 699050 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size of 512 KB.');
  END IF;

  -- Decode and enforce decoded byte limit
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

  -- Server-controlled: load active template from database
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = COALESCE(v_row.consent_type, 'activity')
    AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  -- Stale template protection
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
    signing_method = 'staff_assisted',
    signed_by_staff_id = v_staff_id
  WHERE id = v_row.id;

  RETURN json_build_object('success', true, 'message', 'Consent form signed successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Grant to authenticated only (staff signing)
REVOKE ALL ON FUNCTION public.staff_sign_consent(
  uuid, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_sign_consent(
  uuid, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_sign_consent(
  uuid, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, text
) TO authenticated;

-- =============================================
-- 10. UPDATE get_consent_form_by_token
-- =============================================
-- Returns template version and text for pending forms.

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
      'status', v_row.status,
      'signed_at', v_row.signed_at
    );
  END IF;

  IF v_row.status = 'voided' THEN
    RETURN json_build_object(
      'id', v_row.id,
      'activity_name', v_row.activity_name,
      'guest_name', v_row.guest_name,
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

-- =============================================
-- 11. RPC: get_consent_for_pdf
-- =============================================
-- Authenticated only. Returns signing_method and staff name.
-- boat_crew denied. Watersports staff: booking OR walk-in activity.

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

  -- Watersports staff: booking access OR walk-in activity access
  IF v_role = 'watersports_staff' THEN
    IF v_row.booking_id IS NOT NULL THEN
      IF NOT staff_has_booking_access(v_row.booking_id) THEN
        RAISE EXCEPTION 'Access denied: you do not have access to this consent form.';
      END IF;
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
    'signed_by_staff_name', v_staff_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_consent_for_pdf(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_for_pdf(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_consent_for_pdf(UUID) TO authenticated;

-- =============================================
-- 12. VERIFICATION QUERY
-- =============================================
-- Run after migration to prove only canonical overloads exist:
--
-- SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('sign_consent_form', 'staff_sign_consent')
-- ORDER BY p.proname, args;
--
-- Expected results:
-- sign_consent_form  | text,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text,text
-- staff_sign_consent | uuid,text,text,text,text,text,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text,text

COMMIT;
