-- =============================================
-- 035: RENTAL PAYMENTS
-- =============================================
-- Problem (reported): equipment rentals could not be paid for through the
-- payments table because payments.booking_id was NOT NULL. The MVR 200 rental
-- collected at the front desk never appeared in revenue.
--
-- This migration:
--   1. Makes payments.booking_id nullable and adds payments.rental_id.
--   2. Requires that every payment belongs to a booking OR a rental.
--   3. Tracks payment_status on equipment_rentals (paid / partial / unpaid).
--   4. Adds create_rental_payment RPC (owner / manager / reception).
--   5. Makes void_payment rental-aware.
-- =============================================

BEGIN;

-- =============================================
-- 1. payments: allow rental payments
-- =============================================
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_booking_or_rental;

ALTER TABLE payments ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES equipment_rentals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(rental_id);

-- Every payment must be tied to a booking or a rental.
ALTER TABLE payments ADD CONSTRAINT chk_payments_booking_or_rental
  CHECK (
    booking_id IS NOT NULL OR rental_id IS NOT NULL
  );

-- Rental payments are recorded in the rental's own currency, so the
-- booking-currency snapshot has no meaning for them.
ALTER TABLE payments ALTER COLUMN booking_currency DROP NOT NULL;

-- =============================================
-- 2. equipment_rentals: payment status
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment_rentals'
      AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE equipment_rentals ADD COLUMN payment_status payment_status NOT NULL DEFAULT 'unpaid';
  END IF;
END $$;

-- =============================================
-- 3. CREATE RENTAL PAYMENT RPC
-- =============================================
-- Mirrors create_booking_payment for equipment leases.
-- - Records a completed payment against the rental.
-- - Payment currency must match the rental currency (no cross FX for rentals).
-- - Overpayment protection: total paid cannot exceed
--   (rental_charge_cents + additional_charges_cents).
-- - Recomputes equipment_rentals.payment_status from completed payments only.

CREATE OR REPLACE FUNCTION public.create_rental_payment(
  p_rental_id   UUID,
  p_amount_cents INT,
  p_currency    TEXT,
  p_method      TEXT DEFAULT 'cash',
  p_reference   TEXT DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_staff_id UUID;
  v_rental RECORD;
  v_payable_total INT;
  v_new_total_paid INT;
  v_new_status payment_status;
  v_payment_id UUID;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, or reception.';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  IF p_currency IS NULL OR p_currency NOT IN ('USD', 'MVR') THEN
    RAISE EXCEPTION 'Payment currency must be USD or MVR.';
  END IF;

  IF p_method IS NULL OR p_method = '' THEN
    p_method := 'cash';
  END IF;

  -- Lock the rental row to prevent concurrent payment races
  SELECT r.* INTO v_rental
  FROM public.equipment_rentals r
  WHERE r.id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found.';
  END IF;

  IF p_currency != v_rental.currency THEN
    RAISE EXCEPTION 'Payment currency (%) must match the rental currency (%).', p_currency, v_rental.currency;
  END IF;

  v_payable_total := v_rental.rental_charge_cents + v_rental.additional_charges_cents;

  -- Sum only completed payments for this rental
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.rental_id = p_rental_id
    AND p2.status = 'completed';

  -- Reject overpayment
  IF v_new_total_paid + p_amount_cents > v_payable_total AND v_payable_total > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Overpayment: this payment %s %s + already paid %s %s would exceed the rental total %s %s.',
        (p_amount_cents / 100.0)::NUMERIC(12,2), v_rental.currency,
        (v_new_total_paid / 100.0)::NUMERIC(12,2), v_rental.currency,
        (v_payable_total / 100.0)::NUMERIC(12,2), v_rental.currency
      );
  END IF;

  -- Insert payment (rental-linked, no booking context)
  INSERT INTO public.payments (
    rental_id, amount_cents, currency, method, reference, notes,
    recorded_by, converted_amount_cents, booking_currency, status
  ) VALUES (
    p_rental_id, p_amount_cents, p_currency, p_method,
    NULLIF(TRIM(p_reference), ''), NULLIF(TRIM(p_notes), ''),
    v_staff_id, p_amount_cents, NULL, 'completed'
  )
  RETURNING id INTO v_payment_id;

  -- Recompute rental payment status (completed payments only)
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.rental_id = p_rental_id
    AND p2.status = 'completed';

  IF v_new_total_paid <= 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_payable_total > 0 AND v_new_total_paid >= v_payable_total THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE public.equipment_rentals
  SET payment_status = v_new_status
  WHERE id = p_rental_id;

  RETURN json_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_currency', p_currency,
    'amount_cents', p_amount_cents,
    'converted_amount_cents', p_amount_cents,
    'rental_id', p_rental_id,
    'new_payment_status', v_new_status::TEXT,
    'total_paid_cents', v_new_total_paid,
    'payable_total_cents', v_payable_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.create_rental_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_rental_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_rental_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================
-- 4. VOID PAYMENT: rental-aware
-- =============================================
-- Refactors void_payment so that voiding a rental payment recomputes
-- equipment_rentals.payment_status instead of bookings.payment_status.

CREATE OR REPLACE FUNCTION public.void_payment(
  p_payment_id  UUID,
  p_reason      TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role         TEXT;
  v_staff_id     UUID;
  v_payment      RECORD;
  v_booking      RECORD;
  v_is_rental    BOOLEAN;
  v_new_total    INT;
  v_payable      INT;
  v_new_status   payment_status;
  v_void_reason  TEXT;
BEGIN
  v_role     := public.current_staff_role();
  v_staff_id := public.current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: only owner, manager, or reception can void payments.';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  IF v_payment.status = 'voided' THEN
    RAISE EXCEPTION 'This payment is already voided.';
  END IF;

  IF v_payment.status != 'completed' THEN
    RAISE EXCEPTION 'Only completed payments can be voided. Current status: %', v_payment.status;
  END IF;

  v_is_rental := v_payment.rental_id IS NOT NULL;

  v_void_reason := format(
    '[VOIDED %s by %s] %s',
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    COALESCE((SELECT full_name FROM public.staff_profiles WHERE id = v_staff_id), 'staff'),
    NULLIF(TRIM(p_reason), '')
  );

  UPDATE public.payments
  SET status    = 'voided',
      notes     = CASE
                    WHEN NULLIF(TRIM(notes), '') IS NOT NULL
                    THEN notes || E'\n' || v_void_reason
                    ELSE v_void_reason
                  END,
      updated_at = now()
  WHERE id = p_payment_id;

  IF v_is_rental THEN
    -- Rental payment: recompute equipment_rentals.payment_status
    SELECT r.rental_charge_cents + r.additional_charges_cents
    INTO v_payable
    FROM public.equipment_rentals r
    WHERE r.id = v_payment.rental_id
    FOR UPDATE;

    SELECT COALESCE(SUM(converted_amount_cents), 0)
    INTO v_new_total
    FROM public.payments
    WHERE rental_id = v_payment.rental_id
      AND status = 'completed';

    IF v_new_total <= 0 THEN
      v_new_status := 'unpaid';
    ELSIF v_payable > 0 AND v_new_total >= v_payable THEN
      v_new_status := 'paid';
    ELSE
      v_new_status := 'partial';
    END IF;

    UPDATE public.equipment_rentals
    SET payment_status = v_new_status
    WHERE id = v_payment.rental_id;

    RETURN json_build_object(
      'success', true,
      'voided_payment_id', v_payment.id,
      'payment_amount_cents', v_payment.amount_cents,
      'payment_currency', v_payment.currency,
      'rental_id', v_payment.rental_id,
      'new_payment_status', v_new_status::TEXT,
      'total_paid_cents', v_new_total,
      'payable_total_cents', v_payable
    );
  END IF;

  -- Booking payment path (existing behaviour)
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_payment.booking_id
  FOR UPDATE;

  IF v_booking.total_cents > 0 THEN
    v_payable := v_booking.total_cents;
  ELSE
    v_payable := v_booking.estimated_total_cents;
  END IF;

  SELECT COALESCE(SUM(converted_amount_cents), 0)
  INTO v_new_total
  FROM public.payments
  WHERE booking_id = v_payment.booking_id
    AND status = 'completed';

  IF v_new_total <= 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_new_total >= v_payable THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE public.bookings
  SET payment_status = v_new_status,
      updated_at     = now()
  WHERE id = v_payment.booking_id;

  RETURN json_build_object(
    'success',             true,
    'voided_payment_id',   v_payment.id,
    'payment_amount_cents', v_payment.amount_cents,
    'payment_currency',    v_payment.currency,
    'booking_id',          v_payment.booking_id,
    'new_payment_status',  v_new_status::TEXT,
    'total_paid_cents',    v_new_total,
    'payable_total_cents', v_payable
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.void_payment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_payment(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_payment(UUID, TEXT) TO authenticated;

COMMIT;