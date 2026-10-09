-- =============================================
-- 023: AUTO-OFFER CONSENT ON CONFIRMED + PAID
--      + MANIFEST CHECK-IN CONSENT GATE
-- =============================================
-- Behaviour:
--   1. The moment a booking becomes `confirmed` AND `paid` (in either order),
--      a pending activity-consent form is auto-created for it. This is the
--      "offer consent at booking/payment" step.
--   2. Existing confirmed+paid bookings without a consent form are backfilled.
--   3. Manifest check-in is blocked until the booking has a SIGNED consent form.
-- =============================================

-- =============================================
-- 1. TRIGGER: AUTO-CREATE CONSENT ON CONFIRMED + PAID
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_offer_consent_on_confirm_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_activity_name TEXT;
  v_guest_name    TEXT;
  v_phone         TEXT;
BEGIN
  -- Only act once the booking is confirmed AND fully paid.
  IF NEW.status <> 'confirmed' OR NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;

  -- Only one active (pending/signed) activity consent per booking.
  IF EXISTS (
    SELECT 1 FROM consent_forms c
    WHERE c.booking_id = NEW.id
      AND c.consent_type = 'activity'
      AND c.status IN ('pending', 'signed')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT a.name INTO v_activity_name FROM activities a WHERE a.id = NEW.activity_id;
  SELECT c.full_name, c.phone INTO v_guest_name, v_phone
  FROM customers c WHERE c.id = NEW.customer_id;

  INSERT INTO consent_forms (
    booking_id, customer_id, activity_id, activity_name, booking_ref,
    guest_name, phone, consent_type, status
  ) VALUES (
    NEW.id, NEW.customer_id, NEW.activity_id,
    COALESCE(v_activity_name, 'Activity'), NEW.booking_ref,
    COALESCE(v_guest_name, 'Guest'), v_phone,
    'activity', 'pending'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_bookings_auto_offer_consent ON bookings;
CREATE TRIGGER trg_bookings_auto_offer_consent
  AFTER INSERT OR UPDATE OF status, payment_status ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_offer_consent_on_confirm_paid();

-- =============================================
-- 2. BACKFILL: PENDING CONSENTS FOR EXISTING CONFIRMED + PAID BOOKINGS
-- =============================================
INSERT INTO consent_forms (
  booking_id, customer_id, activity_id, activity_name, booking_ref,
  guest_name, phone, consent_type, status
)
SELECT
  b.id, b.customer_id, b.activity_id, COALESCE(a.name, 'Activity'),
  b.booking_ref, COALESCE(c.full_name, 'Guest'), c.phone, 'activity', 'pending'
FROM bookings b
JOIN customers c ON c.id = b.customer_id
JOIN activities a ON a.id = b.activity_id
WHERE b.status = 'confirmed' AND b.payment_status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM consent_forms cf
    WHERE cf.booking_id = b.id AND cf.consent_type = 'activity'
      AND cf.status IN ('pending', 'signed')
  );

-- =============================================
-- 3. MANIFEST CHECK-IN CONSENT GATE
-- =============================================
CREATE OR REPLACE FUNCTION public.toggle_manifest_checkin(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role   TEXT;
  v_row    trip_manifest%ROWTYPE;
  v_new    BOOLEAN;
  v_ref    TEXT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_row FROM public.trip_manifest m WHERE m.id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest row not found.';
  END IF;

  v_new := NOT v_row.checked_in;
  v_ref := COALESCE(
    (SELECT booking_ref FROM public.bookings WHERE id = v_row.booking_id),
    v_row.booking_id::TEXT
  );

  -- Nobody boards without a signed consent form on file.
  IF v_new AND NOT EXISTS (
    SELECT 1 FROM consent_forms cf
    WHERE cf.booking_id = v_row.booking_id
      AND cf.consent_type = 'activity'
      AND cf.status = 'signed'
  ) THEN
    RAISE EXCEPTION 'Booking % has no signed consent form. The guest must sign the consent and liability form before check-in.', v_ref;
  END IF;

  UPDATE public.trip_manifest
  SET checked_in = v_new,
      checked_in_at = CASE WHEN v_new THEN now() ELSE NULL END
  WHERE id = p_manifest_id;

  RETURN json_build_object('success', true, 'checked_in', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;