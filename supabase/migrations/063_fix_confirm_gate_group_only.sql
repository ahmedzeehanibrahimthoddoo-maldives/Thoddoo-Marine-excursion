-- ================================================================
-- 063 — CONFIRM GATE: only group bookings require every participant
-- ================================================================
-- Regression fix for migration 062's confirmation gate.
--
-- The 062 gate required EVERY booking_participants row to be
-- consent_status='signed' before a booking could be confirmed. That
-- broke the single-activity walk-in/online flow, where consent is
-- captured at the BOOKING level (consent_forms.status='signed' via
-- submit_walkin_consent) and the QR check-in flow (010) auto-creates
-- placeholder participant rows ("Guest N") that never require
-- individual signatures.
--
-- Group bookings (multi-activity wizard, migration 060/061) DO require
-- per-participant signing — every choice_token gets its own consent
-- form. So the gate now applies ONLY when the booking belongs to a
-- booking group (bookings.group_id IS NOT NULL).
-- ================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_booking_confirm_consent()
RETURNS TRIGGER AS $$
DECLARE
  v_unsigned INT;
  v_ref      TEXT;
BEGIN
  -- Only applies on the transition TO 'confirmed'. Completion/cancel/no_show
  -- are unaffected. Admin direct updates are covered too (server-side).
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    -- Only group bookings require every participant to sign. Single-activity
    -- bookings are gated on the booking-level consent form instead.
    IF NEW.group_id IS NOT NULL THEN
      SELECT count(*) INTO v_unsigned
      FROM public.booking_participants bp
      WHERE bp.booking_id = NEW.id
        AND bp.consent_status <> 'signed';

      IF v_unsigned > 0 THEN
        v_ref := COALESCE(NEW.booking_ref, NEW.id::TEXT);
        RAISE EXCEPTION 'Booking % has % unsigned participant(s). Every participant must sign the consent & liability form before confirmation.', v_ref, v_unsigned;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;