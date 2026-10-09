-- =============================================
-- Migration 047: Consent Template v5 — Fixed Capsize Fee + Capsize Recovery Procedure
-- =============================================
-- Rotates the active activity consent from v4 -> v5.
--
-- v5 is built by APPENDING new sections to the existing v4 text
-- (read from the DB, never hardcoded) so no wording is lost:
--   21. FIXED CAPSIZE & RECOVERY FEE (USD 50) — jet ski and kayak /
--       glass kayak
--   22. JET-SKI CAPSIZE RECOVERY PROCEDURE — the craft must be flipped
--       back over CLOCKWISE ONLY; rotating it the other way lets water
--       into the engine and causes damage which is charged to the guest.
--   23. ACKNOWLEDGEMENT OF CAPSIZE FEE & CAPSIZE PROCEDURE
--
-- The fee is now a fixed amount (USD 50) written into the signed text,
-- replacing the earlier "Operator's current fee schedule" wording for the
-- capsize fee only; repair/replacement costs remain quotation-based.
--
-- Signed forms keep a snapshot of their text (consent_text_snapshot), so
-- previously accepted wording is never altered. Pending consents will
-- display v5 at signing.
--
-- Does NOT modify migrations 001–046.
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
-- 2. Create v5 = v4 text + appended capsize fee & procedure sections
-- =============================================
INSERT INTO public.consent_templates (version, consent_type, title, consent_text, active)
SELECT
  'activity-consent-v5',
  'activity',
  'Activity Participation Consent & Liability Waiver (Fixed Capsize Fee / Capsize Procedure)',
  src.consent_text
    || E'\n\n21. FIXED CAPSIZE & RECOVERY FEE (USD 50)\n'
    || E'   - For jet ski and kayak / glass kayak sessions, a fixed capsize / recovery fee of USD 50 (fifty United States dollars) applies whenever the Operator''s staff must recover the participant, the craft, or its equipment after a capsize during the session.\n'
    || E'   - The fixed fee covers staff rescue and recovery only. It is in addition to, and does not replace, the repair or replacement costs for damaged equipment, vessels, or engines set out in sections 13, 14, and 18 above, which remain payable based on the Operator''s written quotation or damage assessment.\n'
    || E'   - The capsize fee is chargeable on demand and the Operator may withhold further services until it is paid.\n\n'
    || E'22. JET-SKI CAPSIZE RECOVERY PROCEDURE (CLOCKWISE ONLY)\n'
    || E'   - The safety briefing will instruct me on the ONLY correct way to right a capsized jet ski: the craft must be flipped back over in the CLOCKWISE direction, turning it toward its own right-hand side, as demonstrated by staff.\n'
    || E'   - I will NOT rotate the jet ski anti-clockwise, flip it onto its opposite side, or roll it any other way. Flipping the craft the wrong way takes in water through the engine intake and causes engine damage.\n'
    || E'   - If a capsize occurs, I will follow the briefing and the demonstrated clockwise procedure, keep clear until the craft is stable, and notify Thoddoo Marine staff immediately. I will not attempt to restart the engine while the craft is upside down or flooded.\n'
    || E'   - Engine damage resulting from flipping the craft the wrong way, from attempting to restart while flooded, or from continuing to ride after a capsize is damage caused by my negligent operation and is charged to me in accordance with sections 13, 14, and 21.\n\n'
    || E'ACKNOWLEDGEMENT: I confirm that I have been briefed on and agree to the fixed USD 50 capsize / recovery fee in section 21 and the clockwise-only jet-ski capsize recovery procedure in section 22, that I understand the financial consequences of a capsize tending to the craft the wrong way or damaging the engine, and I agree to all of the terms and rules in this consent and liability waiver freely and voluntarily.',
  true
FROM (
  SELECT consent_text
  FROM public.consent_templates
  WHERE consent_type = 'activity'
  ORDER BY created_at DESC
  LIMIT 1
) AS src
ON CONFLICT (version) DO NOTHING;

-- =============================================
-- 3. Guarantee exactly one active activity template
-- =============================================
ALTER TABLE public.consent_templates
  DISABLE TRIGGER trg_prevent_template_tampering;

UPDATE public.consent_templates
SET active = false
WHERE consent_type = 'activity'
  AND version <> 'activity-consent-v5';

UPDATE public.consent_templates
SET active = true
WHERE version = 'activity-consent-v5';

ALTER TABLE public.consent_templates
  ENABLE TRIGGER trg_prevent_template_tampering;

COMMIT;

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT version, active, length(consent_text) FROM consent_templates
-- WHERE consent_type = 'activity' ORDER BY created_at;
-- SELECT consent_text LIKE '%FIXED CAPSIZE & RECOVERY FEE (USD 50)%' AS fee,
--        consent_text LIKE '%CLOCKWISE%' AS clockwise,
--        consent_text LIKE '%anti-clockwise%' AS anti_clockwise,
--        consent_text LIKE '%JET-SKI CAPSIZE RECOVERY PROCEDURE%' AS procedure
-- FROM consent_templates WHERE version = 'activity-consent-v5';