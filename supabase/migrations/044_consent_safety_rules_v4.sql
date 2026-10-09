-- =============================================
-- Migration 044: Consent Template v4 — Safety Rules, Briefing, Kayak & Jet-Ski Alarm
-- =============================================
-- Rotates the active activity consent from v3 -> v4.
--
-- v4 is built by APPENDING new sections to the existing v3 text
-- (read from the DB, never hardcoded) so no wording is lost:
--   17. SAFETY RULES & SAFETY BRIEFING (staff will brief before the
--       activity; guest must attend, follow, and ask to clarify).
--   18. KAYAK SPECIFIC SAFETY RULES (life jacket, designated area,
--       capacity, self-rescue, equipment responsibility).
--   19. JET-SKI ENGINE ALARM / OPERATIONAL FAULT RULE (if any warning
--       alarm or signal comes on, STOP immediately, DO NOT continue
--       riding, and notify staff at once).
--   20. ACKNOWLEDGEMENT OF SAFETY RULES, BRIEFING & OPERATIONAL FAULTS
--
-- The jet-ski capsize/recovery fee terms remain in section 14 (v3).
-- Signed forms keep a snapshot of their text, so previously accepted
-- wording is never altered. Pending consents will display v4 at signing.
--
-- Also adds get_consent_pdf_by_token(p_token) — an anon-usable RPC that
-- returns a signed/pending consent's full record for a public PDF
-- download route keyed by the secure signing token (no guessable IDs).
--
-- Does NOT modify migrations 001–043.
-- =============================================

BEGIN;

-- =============================================
-- 1. Deactivate the current active activity template
-- =============================================
ALTER TABLE public.consent_templates
  DISABLE TRIGGER trg_prevent_template_tampering;

UPDATE public.consent_templates
SET active = false
WHERE consent_type = 'activity'
  AND active = true;

ALTER TABLE public.consent_templates
  ENABLE TRIGGER trg_prevent_template_tampering;

-- =============================================
-- 2. Create v4 = v3 text + appended safety rules sections
-- =============================================
INSERT INTO public.consent_templates (version, consent_type, title, consent_text, active)
SELECT
  'activity-consent-v4',
  'activity',
  'Activity Participation Consent & Liability Waiver (Safety Rules / Kayak / Jet-Ski)',
  src.consent_text
    || E'\n\n17. SAFETY RULES & SAFETY BRIEFING\n'
    || E'   - Before the activity begins, an Thoddoo Marine staff member will give a safety briefing covering the activity, the equipment, hand signals, permitted areas, and emergency procedures. I confirm that I will attend the briefing, will follow it, and will ask a staff member to repeat or clarify anything I do not understand before starting.\n'
    || E'   - I will wear the correct safety equipment provided by the Operator (including a life jacket where required) at all times during the activity and will follow all instructions and hand signals given by staff and the guide.\n'
    || E'   - I will stay within the designated permitted area, keep to the agreed session time, and return promptly at the end of the session. I accept that failing to follow the briefing, instructions, or safety rules may stop the activity and may incur charges.\n'
    || E'   - I confirm that I am in a fit state to participate (not under the influence of alcohol or drugs, and not pregnant unless I have declared it) and that the Operator relies on the information I have provided in this consent.\n\n'
    || E'18. KAYAK SPECIFIC SAFETY RULES\n'
    || E'   - I will wear the life jacket provided for the whole time I am on the water and will not remove it while kayaking.\n'
    || E'   - I will keep within the designated kayaking area shown by staff, will not paddle out of sight of the beach, and will not exceed the safe distance set in the briefing.\n'
    || E'   - I will not overload the kayak above its rated capacity, will follow the guide''s instructions, and will stay with the kayak in the event of a capsize (self-rescue or hold on as briefed).\n'
    || E'   - I will not stand up, jump, dive, or change positions in the kayak while on the water, and will not swim in the kayak lanes.\n'
    || E'   - The kayak, paddle, and related equipment are the Operator''s property: I am responsible for returning them in the same condition, ordinary wear and tear excepted, and I will pay reasonable repair or replacement costs (including a lost or damaged paddle) caused by my negligence.\n'
    || E'   - Recovery support within the briefing area is included; paddling outside the permitted area or reckless paddling may incur recovery charges in accordance with the Operator''s fee schedule.\n\n'
    || E'19. JET-SKI ENGINE ALARM / OPERATIONAL FAULT RULE\n'
    || E'   - Before riding, the safety briefing will explain the warning alarm / warning light and the fuel and oil gauges. I confirm I understand how to recognise them.\n'
    || E'   - If at ANY time during the ride a warning alarm, warning light, or buzzer comes on, or if the machine behaves abnormally (for example losing power, overheating, or showing a low oil/fuel warning): I will STOP immediately, will NOT continue riding, will switch off the engine when it is safe to do so, and will notify Thoddoo Marine staff at once.\n'
    || E'   - I understand and agree that continuing to ride after such a warning comes on is dangerous, and that any engine damage that results from failing to stop and notify staff will be charged to me.\n'
    || E'   - The capsize/recovery fee and repair-cost terms in section 14 continue to apply.\n\n'
    || E'ACKNOWLEDGEMENT: I confirm that I will attend and follow the staff safety briefing and all safety rules in sections 17–19 above (including the kayak safety rules and the jet-ski alarm rule requiring me to stop and notify staff if any warning comes on), that I accept financial responsibility for equipment, engine, and vessel damage, jet-ski capsize/recovery fees, and fuel/operational charges as described, and that I agree to all of the terms and rules in this consent and liability waiver freely and voluntarily.',
  true
FROM (
  SELECT consent_text
  FROM public.consent_templates
  WHERE consent_type = 'activity'
    AND version = 'activity-consent-v3'
  LIMIT 1
) AS src
ON CONFLICT (version) DO NOTHING;

-- If v3 was missing, fall back to the newest activity template.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.consent_templates WHERE version = 'activity-consent-v4'
  ) THEN
    INSERT INTO public.consent_templates (version, consent_type, title, consent_text, active)
    SELECT
      'activity-consent-v4',
      'activity',
      'Activity Participation Consent & Liability Waiver (Safety Rules / Kayak / Jet-Ski)',
      consent_text
        || E'\n\n17. SAFETY RULES & SAFETY BRIEFING\n'
        || E'   - I will attend and follow the staff safety briefing, wear the required safety equipment, and stay within the designated area for the agreed time; I will ask staff to clarify anything I do not understand.\n\n'
        || E'18. KAYAK SPECIFIC SAFETY RULES\n'
        || E'   - I will wear the life jacket provided at all times, stay within the designated kayaking area, not overload the kayak, and remain responsible for the kayak, paddle, and equipment; capsizing outside the permitted area or reckless paddling may incur recovery charges.\n\n'
        || E'19. JET-SKI ENGINE ALARM / OPERATIONAL FAULT RULE\n'
        || E'   - If any warning alarm, light, or buzzer comes on or the machine behaves abnormally, I will STOP immediately and NOT continue riding, switch off the engine when safe, and notify staff at once; engine damage from failing to stop will be charged to me.\n\n'
        || E'ACKNOWLEDGEMENT: I agree to all of the terms and rules in this consent and liability waiver, including the safety briefing, kayak rules, and jet-ski alarm rule, freely and voluntarily.',
      true
    FROM public.consent_templates
    WHERE consent_type = 'activity'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
END $$;

-- =============================================
-- 3. Guarantee exactly one active activity template
-- =============================================
ALTER TABLE public.consent_templates
  DISABLE TRIGGER trg_prevent_template_tampering;

UPDATE public.consent_templates
SET active = false
WHERE consent_type = 'activity'
  AND version <> 'activity-consent-v4';

UPDATE public.consent_templates
SET active = true
WHERE version = 'activity-consent-v4';

ALTER TABLE public.consent_templates
  ENABLE TRIGGER trg_prevent_template_tampering;

-- =============================================
-- 4. Public PDF download RPC (token-keyed, anon)
-- =============================================
-- Allows the official PDF to be downloaded by the guest right after
-- signing (or by staff who hold the token). Returns the full signed
-- record including signatures. The token is unguessable and never exposed
-- beyond the signing link, so no other lookup key is required.
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
    'signed_by_staff_name', v_staff_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_consent_pdf_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_pdf_by_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_consent_pdf_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_consent_pdf_by_token(text) TO authenticated;

COMMIT;

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT version, active, length(consent_text) FROM consent_templates
-- WHERE consent_type = 'activity' ORDER BY created_at;
-- SELECT left(text(VERSION parts of v4)...) — find the new sections:
-- SELECT consent_text LIKE '%JET-SKI ENGINE ALARM / OPERATIONAL FAULT RULE%' AS alarm,
--        consent_text LIKE '%KAYAK SPECIFIC SAFETY RULES%' AS kayak,
--        consent_text LIKE '%SAFETY RULES & SAFETY BRIEFING%' AS briefing
-- FROM consent_templates WHERE version = 'activity-consent-v4';