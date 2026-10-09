-- =============================================
-- Migration 041: Staff-recorded damage / accident / operational charges
-- =============================================
-- When a guest damages equipment, capsizes a jet-ski, causes an
-- accident, or incurs fuel/late-return costs, reception records a
-- charge against the booking. The charge is folded into the booking's
-- payable total (total_cents) so the existing payments/invoice flow
-- collects it and get_booking_payment_summary reflects it unchanged.
--
-- Repair/replacement amounts should come from the dealership's written
-- quotation (see consent v3, migration 037). The quotation reference is
-- stored on the charge for the audit trail.
--
-- Adds: booking_charges table
-- Adds: add_booking_charge, void_booking_charge, get_booking_charges
-- Does NOT modify migrations 001–040.
-- =============================================

BEGIN;

-- =============================================
-- 1. BOOKING CHARGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.booking_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.booking_groups(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN (
    'equipment_damage', 'vessel_damage', 'jetski_capsize',
    'fuel', 'late_return', 'accident', 'other'
  )),
  description TEXT NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'MVR')),
  converted_amount_cents INT NOT NULL DEFAULT 0,
  quotation_reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON public.booking_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_charges_group ON public.booking_charges(group_id);
CREATE INDEX IF NOT EXISTS idx_booking_charges_active ON public.booking_charges(booking_id) WHERE voided_at IS NULL;

ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_charges_staff_select ON public.booking_charges;
CREATE POLICY booking_charges_staff_select ON public.booking_charges
  FOR SELECT TO authenticated
  USING (public.current_staff_role() IS NOT NULL);

GRANT SELECT ON public.booking_charges TO authenticated;
REVOKE ALL ON public.booking_charges FROM anon;

-- =============================================
-- 2. RECOMPUTE PAYMENT STATUS HELPER
-- =============================================
-- Mirrors create_booking_payment: payable total is total_cents (staff
-- final amount, which now includes charges) with estimated fallback.
CREATE OR REPLACE FUNCTION public.recompute_booking_payment_status(p_booking_id UUID)
RETURNS payment_status AS $$
DECLARE
  v_booking  RECORD;
  v_paid     INT;
  v_payable  INT;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  SELECT COALESCE(SUM(p.converted_amount_cents), 0) INTO v_paid
  FROM public.payments p
  WHERE p.booking_id = p_booking_id AND p.status = 'completed';

  IF v_booking.total_cents > 0 THEN
    v_payable := v_booking.total_cents;
  ELSE
    v_payable := v_booking.estimated_total_cents;
  END IF;

  IF v_paid <= 0 THEN
    RETURN 'unpaid';
  ELSIF v_paid >= v_payable THEN
    RETURN 'paid';
  ELSE
    RETURN 'partial';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.recompute_booking_payment_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_booking_payment_status(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_booking_payment_status(UUID) FROM authenticated;

-- =============================================
-- 3. ADD A CHARGE
-- =============================================
CREATE OR REPLACE FUNCTION public.add_booking_charge(
  p_booking_id          UUID,
  p_category            TEXT,
  p_description         TEXT,
  p_amount_cents        INT,
  p_currency            TEXT DEFAULT 'USD',
  p_quotation_reference TEXT DEFAULT NULL,
  p_notes               TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role       TEXT;
  v_staff_id   UUID;
  v_booking    RECORD;
  v_currency   TEXT;
  v_converted  INT;
  v_new_total  INT;
  v_charge_id  UUID;
  v_status     payment_status;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager or reception.';
  END IF;

  IF p_category IS NULL OR p_category NOT IN (
    'equipment_damage', 'vessel_damage', 'jetski_capsize',
    'fuel', 'late_return', 'accident', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid charge category.';
  END IF;
  IF p_description IS NULL OR length(trim(p_description)) < 3 THEN
    RAISE EXCEPTION 'A description of the charge is required.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Charge amount must be greater than zero.';
  END IF;

  v_currency := COALESCE(NULLIF(trim(p_currency), ''), 'USD');
  IF v_currency NOT IN ('USD', 'MVR') THEN
    RAISE EXCEPTION 'Charge currency must be USD or MVR.';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  -- Convert the charge into the booking currency
  IF v_currency = v_booking.booking_currency THEN
    v_converted := p_amount_cents;
  ELSIF v_currency = 'USD' AND v_booking.booking_currency = 'MVR' THEN
    v_converted := ROUND(p_amount_cents * v_booking.exchange_rate_mvr_per_usd);
  ELSIF v_currency = 'MVR' AND v_booking.booking_currency = 'USD' THEN
    v_converted := ROUND(p_amount_cents / v_booking.exchange_rate_mvr_per_usd);
  ELSE
    RAISE EXCEPTION 'Unsupported currency combination.';
  END IF;

  INSERT INTO public.booking_charges (
    booking_id, group_id, category, description, amount_cents, currency,
    converted_amount_cents, quotation_reference, notes, created_by
  ) VALUES (
    p_booking_id, v_booking.group_id, p_category, trim(p_description),
    p_amount_cents, v_currency, v_converted,
    NULLIF(TRIM(p_quotation_reference), ''), NULLIF(TRIM(p_notes), ''), v_staff_id
  )
  RETURNING id INTO v_charge_id;

  -- Fold the charge into the payable total
  v_new_total := CASE WHEN v_booking.total_cents > 0
                      THEN v_booking.total_cents
                      ELSE v_booking.estimated_total_cents END + v_converted;

  UPDATE public.bookings
  SET total_cents = v_new_total, updated_at = now()
  WHERE id = p_booking_id;

  v_status := public.recompute_booking_payment_status(p_booking_id);
  UPDATE public.bookings SET payment_status = v_status WHERE id = p_booking_id;

  RETURN json_build_object(
    'success', true,
    'charge_id', v_charge_id,
    'converted_amount_cents', v_converted,
    'booking_currency', v_booking.booking_currency,
    'new_total_cents', v_new_total,
    'payment_status', v_status::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.add_booking_charge(UUID, TEXT, TEXT, INT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_booking_charge(UUID, TEXT, TEXT, INT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_booking_charge(UUID, TEXT, TEXT, INT, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================
-- 4. VOID A CHARGE
-- =============================================
CREATE OR REPLACE FUNCTION public.void_booking_charge(
  p_charge_id UUID,
  p_reason    TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role      TEXT;
  v_staff_id  UUID;
  v_charge    RECORD;
  v_booking   RECORD;
  v_new_total INT;
  v_status    payment_status;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager or reception.';
  END IF;

  SELECT * INTO v_charge FROM public.booking_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge not found.';
  END IF;
  IF v_charge.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Charge is already voided.';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_charge.booking_id FOR UPDATE;

  UPDATE public.booking_charges
  SET voided_at = now(),
      voided_by = v_staff_id,
      notes = COALESCE(NULLIF(TRIM(p_reason), ''), notes)
  WHERE id = p_charge_id;

  v_new_total := GREATEST(COALESCE(v_booking.total_cents, 0) - v_charge.converted_amount_cents, 0);
  UPDATE public.bookings SET total_cents = v_new_total, updated_at = now() WHERE id = v_booking.id;

  v_status := public.recompute_booking_payment_status(v_booking.id);
  UPDATE public.bookings SET payment_status = v_status WHERE id = v_booking.id;

  RETURN json_build_object(
    'success', true,
    'charge_id', p_charge_id,
    'new_total_cents', v_new_total,
    'payment_status', v_status::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.void_booking_charge(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_booking_charge(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_booking_charge(UUID, TEXT) TO authenticated;

-- =============================================
-- 5. LIST CHARGES FOR A BOOKING
-- =============================================
CREATE OR REPLACE FUNCTION public.get_booking_charges(p_booking_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_out  JSON;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json) INTO v_out
  FROM (
    SELECT id, booking_id, category, description, amount_cents, currency,
           converted_amount_cents, quotation_reference, notes,
           created_by, created_at, voided_at, voided_by
    FROM public.booking_charges
    WHERE booking_id = p_booking_id
  ) t;

  RETURN v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_booking_charges(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_charges(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_booking_charges(UUID) TO authenticated;

COMMIT;
