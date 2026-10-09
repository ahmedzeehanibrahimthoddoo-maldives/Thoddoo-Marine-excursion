-- =============================================
-- Migration 048: remove the card-fee fold from create_booking_payment
-- =============================================
-- The 4.5% card processing fee is no longer recorded as a booking
-- charge and is no longer folded into bookings.total_cents. Guest
-- invoices must show only the quoted booking price.
--
-- The fee calculation itself stays in the admin PMS (PaymentForm in
-- app/admin/payments/PaymentForm.tsx) as staff guidance for how much
-- to key into the card terminal so the business nets the quoted price;
-- the recorded booking payment is the quoted amount.
--
-- card_fee_rate_pct() and any historical card_fee booking_charges are
-- left untouched (old invoices keep their recorded history).
--
-- Does NOT modify migrations 001–047.
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_booking_payment(
  p_booking_id    UUID,
  p_amount_cents  INT,
  p_currency      TEXT,
  p_method        TEXT DEFAULT 'cash',
  p_reference     TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role          TEXT;
  v_staff_id      UUID;
  v_booking       RECORD;
  v_payment_currency TEXT;
  v_converted     INT;
  v_new_total_paid INT;
  v_new_status    payment_status;
  v_payment_id    UUID;
  v_payable_total INT;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
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

  -- Lock the booking row to prevent concurrent payment races
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot record payment for a cancelled booking.';
  END IF;

  v_payment_currency := p_currency;

  -- Convert payment amount to booking currency
  IF v_payment_currency = v_booking.booking_currency THEN
    v_converted := p_amount_cents;
  ELSIF v_payment_currency = 'USD' AND v_booking.booking_currency = 'MVR' THEN
    v_converted := ROUND(p_amount_cents * v_booking.exchange_rate_mvr_per_usd);
  ELSIF v_payment_currency = 'MVR' AND v_booking.booking_currency = 'USD' THEN
    v_converted := ROUND(p_amount_cents / v_booking.exchange_rate_mvr_per_usd);
  ELSE
    RAISE EXCEPTION 'Unsupported currency combination.';
  END IF;

  -- Payable is the quoted price — no card surcharge is folded in.
  IF v_booking.total_cents > 0 THEN
    v_payable_total := v_booking.total_cents;
  ELSE
    v_payable_total := v_booking.estimated_total_cents;
  END IF;

  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.booking_id = p_booking_id AND p2.status = 'completed';

  IF v_new_total_paid + v_converted > v_payable_total AND v_payable_total > 0 THEN
    RAISE EXCEPTION
      USING MESSAGE = format(
        'Overpayment: this payment %s %s + already paid %s %s would exceed total %s %s.',
        (v_converted / 100.0)::NUMERIC(12,2), v_booking.booking_currency,
        (v_new_total_paid / 100.0)::NUMERIC(12,2), v_booking.booking_currency,
        (v_payable_total / 100.0)::NUMERIC(12,2), v_booking.booking_currency);
  END IF;

  INSERT INTO public.payments
    (booking_id, amount_cents, currency, method, reference, notes, recorded_by,
     booking_rate_snapshot, converted_amount_cents, booking_currency, status)
  VALUES
    (p_booking_id, p_amount_cents, v_payment_currency, p_method,
     NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''), v_staff_id,
     v_booking.exchange_rate_mvr_per_usd, v_converted, v_booking.booking_currency, 'completed')
  RETURNING id INTO v_payment_id;

  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.booking_id = p_booking_id AND p2.status = 'completed';

  IF v_new_total_paid <= 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_new_total_paid >= v_payable_total THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE public.bookings
  SET payment_status = v_new_status, updated_at = now()
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_currency', v_payment_currency,
    'amount_cents', p_amount_cents,
    'converted_amount_cents', v_converted,
    'booking_currency', v_booking.booking_currency,
    'new_payment_status', v_new_status::TEXT,
    'total_paid_cents', v_new_total_paid,
    'payable_total_cents', v_payable_total,
    'estimated_total_cents', v_booking.estimated_total_cents,
    'total_cents', v_payable_total,
    'card_fee_cents', 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public;

REVOKE ALL ON FUNCTION public.create_booking_payment(UUID,INT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_payment(UUID,INT,TEXT,TEXT,TEXT,TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_booking_payment(UUID,INT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

COMMIT;

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT pg_get_functiondef('public.create_booking_payment(UUID,INT,TEXT,TEXT,TEXT,TEXT)')
--        NOT LIKE '%card_fee_rate_pct()%' AS has_fee_logic;