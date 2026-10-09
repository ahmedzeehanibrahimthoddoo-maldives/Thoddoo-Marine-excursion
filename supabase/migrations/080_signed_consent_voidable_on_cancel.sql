-- 080_signed_consent_voidable_on_cancel.sql
--
-- Two earlier migrations contradict each other:
--   009  a signed consent form is immutable — "no status change" — and any
--        update raises 'Signed consent forms are immutable'.
--   062  cancelling a booking voids its consent forms WHERE status IN
--        ('pending','signed') — signed included.
--
-- Because 062's trigger is BEFORE UPDATE on bookings, it tried to void a signed
-- consent while 009's trigger was still active, so cancelling any booking whose
-- consent was signed always failed. Staff could not cancel a guest who had
-- already signed (no-show, weather, guest cancellation).
--
-- Fix, keeping both intents:
--   * A signed consent is still immutable in every respect — no edit to the
--     signature, the witness, the snapshot, the answers or the timestamps can
--     ever be made.
--   * The signed -> voided transition is permitted only while the booking is
--     being cancelled, signalled by a transaction-local flag set by 062's
--     trigger. A direct update can therefore never void a signed consent, so
--     the deliberate rule in 006 ("only pending consent forms can be voided")
--     and the admin UI's guidance still hold.
--
-- Records are kept, exactly as 062 intended: voiding records that the consent
-- no longer applies, not what the guest agreed to.

begin;

-- =============================================
-- 1. Mark the void as coming from a booking cancellation
-- =============================================
CREATE OR REPLACE FUNCTION public.void_consent_on_booking_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    -- Transaction-local: cannot leak to any later statement or request.
    PERFORM set_config('app.consent_void_from_cancel', '1', true);
    UPDATE public.consent_forms
    SET status = 'voided',
        void_reason = COALESCE(NULLIF(trim(void_reason), ''), 'Booking cancelled'),
        voided_at = now(),
        voided_by = COALESCE(voided_by, public.current_staff_id())
    WHERE booking_id = NEW.id
      AND status IN ('pending', 'signed');
    PERFORM set_config('app.consent_void_from_cancel', '', true);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_cancel_voids_consents ON public.bookings;
CREATE TRIGGER trg_bookings_cancel_voids_consents
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.void_consent_on_booking_cancel();

-- =============================================
-- 2. Signed consents: immutable content, voidable only via booking cancellation
-- =============================================
CREATE OR REPLACE FUNCTION public.prevent_signed_consent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    IF NEW.status <> 'voided'
       OR current_setting('app.consent_void_from_cancel', true) IS DISTINCT FROM '1'
       -- What the guest agreed to, and who signed it, must be identical.
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.activity_id IS DISTINCT FROM OLD.activity_id
       OR NEW.activity_name IS DISTINCT FROM OLD.activity_name
       OR NEW.booking_ref IS DISTINCT FROM OLD.booking_ref
       OR NEW.guest_name IS DISTINCT FROM OLD.guest_name
       OR NEW.nationality IS DISTINCT FROM OLD.nationality
       OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
       OR NEW.passport_number IS DISTINCT FROM OLD.passport_number
       OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.hotel IS DISTINCT FROM OLD.hotel
       OR NEW.room_number IS DISTINCT FROM OLD.room_number
       OR NEW.emergency_contact_name IS DISTINCT FROM OLD.emergency_contact_name
       OR NEW.emergency_contact_phone IS DISTINCT FROM OLD.emergency_contact_phone
       OR NEW.swimming_ability IS DISTINCT FROM OLD.swimming_ability
       OR NEW.medical_conditions IS DISTINCT FROM OLD.medical_conditions
       OR NEW.allergies IS DISTINCT FROM OLD.allergies
       OR NEW.medications IS DISTINCT FROM OLD.medications
       OR NEW.recent_injuries IS DISTINCT FROM OLD.recent_injuries
       OR NEW.is_pregnant IS DISTINCT FROM OLD.is_pregnant
       OR NEW.safety_briefing_confirmed IS DISTINCT FROM OLD.safety_briefing_confirmed
       OR NEW.life_jacket_confirmed IS DISTINCT FROM OLD.life_jacket_confirmed
       OR NEW.risk_acknowledged IS DISTINCT FROM OLD.risk_acknowledged
       OR NEW.photo_consent IS DISTINCT FROM OLD.photo_consent
       OR NEW.signature_data_url IS DISTINCT FROM OLD.signature_data_url
       OR NEW.witness_name IS DISTINCT FROM OLD.witness_name
       OR NEW.witness_signature_data_url IS DISTINCT FROM OLD.witness_signature_data_url
       OR NEW.parent_guardian_name IS DISTINCT FROM OLD.parent_guardian_name
       OR NEW.parent_guardian_signature_data_url IS DISTINCT FROM OLD.parent_guardian_signature_data_url
       OR NEW.is_minor IS DISTINCT FROM OLD.is_minor
       OR NEW.form_version IS DISTINCT FROM OLD.form_version
       OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
       OR NEW.consent_text_snapshot IS DISTINCT FROM OLD.consent_text_snapshot
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signing_token IS DISTINCT FROM OLD.signing_token
       OR NEW.signing_token_expires_at IS DISTINCT FROM OLD.signing_token_expires_at
       OR NEW.signing_method IS DISTINCT FROM OLD.signing_method
       OR NEW.signed_by_staff_id IS DISTINCT FROM OLD.signed_by_staff_id
       OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
       OR NEW.rental_id IS DISTINCT FROM OLD.rental_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Signed consent forms are immutable and cannot be modified.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_signed_consent_modification ON consent_forms;
CREATE TRIGGER trg_prevent_signed_consent_modification
  BEFORE UPDATE ON consent_forms
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_signed_consent_modification();

commit;