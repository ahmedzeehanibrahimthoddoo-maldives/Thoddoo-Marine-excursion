-- =============================================
-- Migration 037: Consent Template v3 — Liability, Equipment Damage & Jet-Ski
-- =============================================
-- Rotates the active activity consent from v2 -> v3.
--
-- v3 is built by APPENDING new liability sections to the existing v2
-- text (read from the DB, never hardcoded) so no wording is lost:
--   13. Equipment, vessel & property damage
--   14. Jet-ski / personal watercraft specific terms
--   15. Accidents, injury & medical costs
--   16. Fuel, late return & operational charges
--
-- Charging model is guest-initiated charges recorded by staff through
-- the existing payments/invoices flow (see migrations 041+). Amounts
-- are not hardcoded here: the guest agrees that repair/replacement is
-- set by the Operator's written dealership/service-centre quotation.
--
-- Signed forms keep a snapshot of their text (consent_text_snapshot),
-- so rotating the template never alters previously accepted wording.
--
-- Does NOT modify migrations 001–036.
-- =============================================

BEGIN;

-- =============================================
-- 1. Deactivate the current active activity template
-- =============================================
-- The tamper trigger blocks UPDATE on templates referenced by signed
-- consents, so it is briefly disabled for the rotation (mirrors 022).
ALTER TABLE public.consent_templates
  DISABLE TRIGGER trg_prevent_template_tampering;

UPDATE public.consent_templates
SET active = false
WHERE consent_type = 'activity'
  AND active = true;

ALTER TABLE public.consent_templates
  ENABLE TRIGGER trg_prevent_template_tampering;

-- =============================================
-- 2. Create v3 = v2 text + appended liability sections
-- =============================================
-- If v2 is somehow missing, fall back to the most recent activity
-- template so a rotation can never leave the type with no active row.
INSERT INTO public.consent_templates (version, consent_type, title, consent_text, active)
SELECT
  'activity-consent-v3',
  'activity',
  'Activity Participation Consent & Liability Waiver (Equipment Damage / Jet-Ski)',
  src.consent_text
    || E'\n\n13. EQUIPMENT, VESSEL & PROPERTY DAMAGE\n'
    || E'   - I am responsible for the equipment, vessel, engine, and other property entrusted to me during the activity.\n'
    || E'   - I will pay for the repair or replacement of any equipment, vessel, or property that is lost, damaged, or destroyed through my negligence, reckless operation, or wilful misconduct.\n'
    || E'   - The cost of repair or replacement is determined by the Operator using a written quotation from the relevant dealership, workshop, or service centre (or, where no such quotation is available, an independent assessment). I agree that this written quotation is conclusive evidence of the amount owed to the Operator.\n'
    || E'   - I agree to settle any such charge on demand, and I understand the Operator may withhold services until the amount is paid. These charges are in addition to, and do not limit, any other liability I may have at law.\n\n'
    || E'14. JET-SKI / PERSONAL WATERCRAFT — SPECIFIC TERMS\n'
    || E'   - I will operate the personal watercraft only in the designated riding area, only during the agreed session, and only if I am the named operator or an authorised rider.\n'
    || E'   - I will not beach, ground, jump the wake of other vessels, ride recklessly, or allow any unauthorised person to operate the watercraft.\n'
    || E'   - If the watercraft capsizes, rolls over, or is swamped through my operation, I agree to pay the Operator the applicable capsize/recovery fee set out in the Operator\'s current fee schedule (available at the front desk), together with the cost of any resulting repair, recovery, or inspection.\n'
    || E'   - A non-operator rider or passenger accepts the inherent risks of riding and is responsible for their own safety and conduct; the operator remains responsible for any damage or injury caused by their operation.\n'
    || E'   - Fuel is not included unless expressly stated in the booking, and refuelling or excess fuel used during private hire is chargeable.\n\n'
    || E'15. ACCIDENTS, INJURY & MEDICAL COSTS\n'
    || E'   - I participate voluntarily and at my own risk. I am responsible for my own medical expenses, including treatment, evacuation, and repatriation, and I am strongly advised to hold comprehensive travel and medical insurance.\n'
    || E'   - Where my negligence, reckless operation, or breach of this consent causes injury to another person or damage to property, I am responsible for the resulting costs, losses, and claims.\n'
    || E'   - I will immediately report any accident, injury, near-miss, or equipment damage to the Operator before leaving the site.\n\n'
    || E'16. FUEL, LATE RETURN & OPERATIONAL CHARGES\n'
    || E'   - Private hire and extended sessions may be subject to fuel, wear, and late-return charges as set out in the Operator\'s fee schedule.\n'
    || E'   - I will return all equipment and the vessel at the agreed time and in the condition in which it was provided, ordinary wear and tear excepted.\n\n'
    || E'ACKNOWLEDGEMENT: I have read and understood sections 13–16, I accept financial responsibility for equipment and vessel damage, jet-ski capsize/recovery fees, accident-related costs, and fuel/operational charges as described, and I confirm that this consent is given freely.',
  true
FROM (
  SELECT consent_text
  FROM public.consent_templates
  WHERE consent_type = 'activity'
    AND version = 'activity-consent-v2'
  UNION ALL
  SELECT consent_text
  FROM public.consent_templates
  WHERE consent_type = 'activity'
    AND version = 'activity-consent-v2'
  LIMIT 1
) AS src
ON CONFLICT (version) DO NOTHING;

-- If v2 was missing, fall back to whichever activity template is newest.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.consent_templates WHERE version = 'activity-consent-v3'
  ) THEN
    INSERT INTO public.consent_templates (version, consent_type, title, consent_text, active)
    SELECT
      'activity-consent-v3',
      'activity',
      'Activity Participation Consent & Liability Waiver (Equipment Damage / Jet-Ski)',
      consent_text
        || E'\n\n13. EQUIPMENT, VESSEL & PROPERTY DAMAGE\n'
        || E'   - I am responsible for the equipment and vessel entrusted to me and will pay for repair or replacement of anything lost or damaged through my negligence, determined by the Operator''s written dealership/service-centre quotation.\n\n'
        || E'14. JET-SKI / PERSONAL WATERCRAFT — SPECIFIC TERMS\n'
        || E'   - I will ride only in the designated area as the named operator or authorised rider. Capsize/rollover, reckless riding, beaching, or unauthorised use may incur the Operator''s capsize/recovery fee plus repair costs. Fuel is not included.\n\n'
        || E'15. ACCIDENTS, INJURY & MEDICAL COSTS\n'
        || E'   - I participate at my own risk and am responsible for my own medical costs and for any injury or damage caused by my negligence.\n\n'
        || E'16. FUEL, LATE RETURN & OPERATIONAL CHARGES\n'
        || E'   - Fuel, wear, and late-return charges apply as per the Operator''s fee schedule.',
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
-- The tamper trigger returns OLD for permitted UPDATEs (see 009), which
-- would swallow this change, so it is disabled for the activation too.
ALTER TABLE public.consent_templates
  DISABLE TRIGGER trg_prevent_template_tampering;

UPDATE public.consent_templates
SET active = false
WHERE consent_type = 'activity'
  AND version <> 'activity-consent-v3';

UPDATE public.consent_templates
SET active = true
WHERE version = 'activity-consent-v3';

ALTER TABLE public.consent_templates
  ENABLE TRIGGER trg_prevent_template_tampering;

COMMIT;

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT version, active, length(consent_text), left(consent_text, 80)
-- FROM consent_templates WHERE consent_type = 'activity' ORDER BY created_at;
