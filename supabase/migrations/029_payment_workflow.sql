-- 029_payment_workflow.sql
-- Add void payment capability, payments.updated_at column, and extend the
-- payments.status CHECK to include 'voided' (void = accounting-correct
-- cancellation that preserves the audit trail).

begin;

-- =============================================
-- 1. payments.updated_at + extend status CHECK
-- =============================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status;
ALTER TABLE payments ADD CONSTRAINT chk_payments_status
  CHECK (status IN ('completed', 'failed', 'pending', 'refunded', 'voided'));

-- =============================================
-- 2. void_payment RPC
-- =============================================
-- Locks the payment row, flips status to 'voided', rewrites notes with
-- the reason (preserving any existing notes), then recompute
-- bookings.payment_status from remaining completed payments only.
-- Role gate: owner / manager / reception (finance roles).

CREATE OR REPLACE FUNCTION public.void_payment(
  p_payment_id  UUID,
  p_reason      TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role         TEXT;
  v_staff_id     UUID;
  v_payment      RECORD;
  v_booking      RECORD;
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

  -- Lock the payment row
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

  -- Build void reason note
  v_void_reason := format(
    '[VOIDED %s by %s] %s',
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    COALESCE((SELECT full_name FROM public.staff_profiles WHERE id = v_staff_id), 'staff'),
    NULLIF(TRIM(p_reason), '')
  );

  -- Flip the payment to voided
  UPDATE public.payments
  SET status    = 'voided',
      notes     = CASE
                    WHEN NULLIF(TRIM(notes), '') IS NOT NULL
                    THEN notes || E'\n' || v_void_reason
                    ELSE v_void_reason
                  END,
      updated_at = now()
  WHERE id = p_payment_id;

  -- Lock the booking to recompute payment_status
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_payment.booking_id
  FOR UPDATE;

  -- Determine payable total
  IF v_booking.total_cents > 0 THEN
    v_payable := v_booking.total_cents;
  ELSE
    v_payable := v_booking.estimated_total_cents;
  END IF;

  -- Sum remaining completed payments only
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

commit;