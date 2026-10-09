-- =============================================
-- Thoddoo Marine – Currency Support 008
-- Dual-currency (USD/MVR), exchange rate snapshot
-- Atomic payment recording with balance/status recalculation
-- Strict currency writes, overpayment protection, row locking
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 1. ADD CURRENCY COLUMNS
-- =============================================

ALTER TABLE activities ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE activities ADD CONSTRAINT chk_activities_currency CHECK (currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE activity_pricing ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE activity_pricing ADD CONSTRAINT chk_activity_pricing_currency CHECK (currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE equipment ADD CONSTRAINT chk_equipment_currency CHECK (currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE equipment_rentals ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE equipment_rentals ADD CONSTRAINT chk_rentals_currency CHECK (currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_currency CHECK (currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 2. BOOKING CURRENCY SNAPSHOT COLUMNS
-- =============================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT chk_bookings_booking_currency CHECK (booking_currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS exchange_rate_mvr_per_usd NUMERIC(10,4) NOT NULL DEFAULT 18;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT chk_bookings_exchange_rate CHECK (exchange_rate_mvr_per_usd > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS converted_usd_cents INT DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS converted_mvr_laari INT DEFAULT 0;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_rate_snapshot NUMERIC(10,4) DEFAULT 18;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_rate_snapshot CHECK (booking_rate_snapshot > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS converted_amount_cents INT DEFAULT 0;

-- =============================================
-- 2b. PAYMENT BOOKING_CURRENCY SNAPSHOT
-- =============================================
-- Snapshot of the booking's currency at payment time for audit.
-- Forced from the booking row by the RPC, never from client input.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_currency TEXT NOT NULL DEFAULT 'USD';
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_booking_currency CHECK (booking_currency IN ('USD', 'MVR'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 2c. PAYMENT STATUS COLUMN
-- =============================================
-- Individual payment status for completed-only filtering.
-- Existing rows default to 'completed'.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_status CHECK (status IN ('completed', 'failed', 'pending', 'refunded'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 3. NON-NEGATIVE CONSTRAINTS
-- =============================================

DO $$ BEGIN
  ALTER TABLE activities ADD CONSTRAINT chk_activities_base_price CHECK (base_price_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE activity_pricing ADD CONSTRAINT chk_pricing_price CHECK (price_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE equipment ADD CONSTRAINT chk_equipment_daily_rate CHECK (daily_rate_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE equipment ADD CONSTRAINT chk_equipment_deposit CHECK (deposit_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE equipment_rentals ADD CONSTRAINT chk_rentals_charge CHECK (rental_charge_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE equipment_rentals ADD CONSTRAINT chk_rentals_deposit CHECK (deposit_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE equipment_rentals ADD CONSTRAINT chk_rentals_additional CHECK (additional_charges_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payments_amount CHECK (amount_cents > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT chk_bookings_estimated CHECK (estimated_total_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT chk_bookings_total CHECK (total_cents >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 4. BACKFILL EXISTING DATA
-- =============================================

-- Currency backfill — safe, all existing data is USD
UPDATE activities SET currency = 'USD' WHERE currency IS NULL;
UPDATE activity_pricing SET currency = 'USD' WHERE currency IS NULL;
UPDATE equipment SET currency = 'USD' WHERE equipment.currency IS NULL;
UPDATE equipment_rentals SET currency = 'USD' WHERE equipment_rentals.currency IS NULL;
UPDATE payments SET currency = 'USD' WHERE payments.currency IS NULL;

-- Booking currency backfill
UPDATE bookings
SET converted_usd_cents = estimated_total_cents,
    converted_mvr_laari = estimated_total_cents * 18
WHERE converted_usd_cents = 0 AND converted_mvr_laari = 0;

-- Payment backfill — snapshot booking_currency from booking, convert amounts
UPDATE payments p
SET booking_currency = COALESCE(b.booking_currency, 'USD'),
    booking_rate_snapshot = COALESCE(b.exchange_rate_mvr_per_usd, 18),
    converted_amount_cents = p.amount_cents
FROM bookings b
WHERE p.booking_id = b.id
  AND p.converted_amount_cents = 0;

-- Payments without a booking get default snapshot
UPDATE payments p
SET booking_currency = 'USD',
    booking_rate_snapshot = 18,
    converted_amount_cents = p.amount_cents
WHERE p.converted_amount_cents = 0;

-- Backfill payment status — existing rows are all completed
UPDATE payments SET status = 'completed' WHERE status IS NULL;

-- =============================================
-- 5. REVOKE ANON ACCESS
-- =============================================

REVOKE ALL ON bookings FROM anon;
REVOKE ALL ON customers FROM anon;

-- =============================================
-- 6. SUBMIT PUBLIC BOOKING (unchanged signature)
-- =============================================

CREATE OR REPLACE FUNCTION public.submit_public_booking(
  p_activity_id         UUID,
  p_pricing_option_label TEXT,
  p_booking_date        TEXT,
  p_preferred_time      TEXT,
  p_guest_name          TEXT,
  p_guest_phone         TEXT,
  p_adults              INT,
  p_children            INT,
  p_hotel_name          TEXT,
  p_room_number         TEXT,
  p_pickup_location     TEXT,
  p_special_requests    TEXT,
  p_idempotency_key     TEXT,
  p_guest_agreed        BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_act_id         UUID;
  v_act_name       TEXT;
  v_act_base       INT;
  v_act_currency   TEXT;
  v_pricing_cents  INT;
  v_pricing_unit   TEXT;
  v_pricing_currency TEXT;
  v_customer_id    UUID;
  v_booking_ref    TEXT;
  v_estimated      INT;
  v_total_guests   INT;
  v_booking_date   DATE;
  v_phone_clean    TEXT;
  v_name_clean     TEXT;
  v_idem_key       UUID;
  v_existing_ref   TEXT;
  v_hotel_clean    TEXT;
  v_room_clean     TEXT;
  v_exchange_rate  NUMERIC(10,4);
  v_converted_usd  INT;
  v_converted_mvr  INT;
BEGIN
  IF p_guest_agreed IS NOT TRUE THEN
    RETURN json_build_object('error', 'You must agree to the terms to submit a booking enquiry.');
  END IF;

  IF p_activity_id IS NULL THEN
    RETURN json_build_object('error', 'Activity is required.');
  END IF;

  v_name_clean := trim(p_guest_name);
  IF v_name_clean IS NULL OR length(v_name_clean) < 2 THEN
    RETURN json_build_object('error', 'Full name is required (at least 2 characters).');
  END IF;
  IF length(v_name_clean) > 120 THEN
    RETURN json_build_object('error', 'Name must be 120 characters or fewer.');
  END IF;

  v_phone_clean := regexp_replace(trim(p_guest_phone), '[^0-9+]', '', 'g');
  IF v_phone_clean IS NULL OR length(v_phone_clean) < 7 THEN
    RETURN json_build_object('error', 'A valid WhatsApp number with country code is required.');
  END IF;
  IF length(v_phone_clean) > 20 THEN
    RETURN json_build_object('error', 'Phone number is too long.');
  END IF;

  IF p_adults IS NULL OR p_adults < 1 THEN
    RETURN json_build_object('error', 'At least 1 adult is required.');
  END IF;
  IF p_adults > 50 THEN
    RETURN json_build_object('error', 'Maximum 50 adults per booking.');
  END IF;

  IF p_children IS NULL OR p_children < 0 THEN
    RETURN json_build_object('error', 'Number of children cannot be negative.');
  END IF;
  IF p_children > 30 THEN
    RETURN json_build_object('error', 'Maximum 30 children per booking.');
  END IF;

  v_total_guests := p_adults + p_children;
  IF v_total_guests > 50 THEN
    RETURN json_build_object('error', 'Maximum 50 total guests per booking.');
  END IF;

  BEGIN
    v_booking_date := trim(p_booking_date)::DATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'Invalid booking date format. Use YYYY-MM-DD.');
  END;

  IF v_booking_date IS NULL THEN
    RETURN json_build_object('error', 'Booking date is required.');
  END IF;

  IF v_booking_date < ((now() AT TIME ZONE 'Indian/Maldives')::DATE) THEN
    RETURN json_build_object('error', 'Booking date cannot be in the past.');
  END IF;

  IF v_booking_date > ((now() AT TIME ZONE 'Indian/Maldives')::DATE + INTERVAL '365 days') THEN
    RETURN json_build_object('error', 'Booking date must be within the next year.');
  END IF;

  IF p_preferred_time IS NOT NULL AND trim(p_preferred_time) != '' THEN
    IF trim(p_preferred_time) !~ '^\d{1,2}:\d{2}$' THEN
      RETURN json_build_object('error', 'Invalid time format. Use HH:MM (e.g. 09:00).');
    END IF;
  END IF;

  v_hotel_clean := NULLIF(trim(p_hotel_name), '');
  IF v_hotel_clean IS NOT NULL AND length(v_hotel_clean) > 120 THEN
    RETURN json_build_object('error', 'Hotel name must be 120 characters or fewer.');
  END IF;

  v_room_clean := NULLIF(trim(p_room_number), '');
  IF v_room_clean IS NOT NULL AND length(v_room_clean) > 30 THEN
    RETURN json_build_object('error', 'Room number must be 30 characters or fewer.');
  END IF;

  IF p_pickup_location IS NOT NULL AND length(trim(p_pickup_location)) > 120 THEN
    RETURN json_build_object('error', 'Pickup location must be 120 characters or fewer.');
  END IF;

  IF p_special_requests IS NOT NULL AND length(trim(p_special_requests)) > 500 THEN
    RETURN json_build_object('error', 'Special requests must be 500 characters or fewer.');
  END IF;

  IF p_pricing_option_label IS NULL OR trim(p_pricing_option_label) = '' THEN
    RETURN json_build_object('error', 'Please select a pricing option.');
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN json_build_object('error', 'Submission error. Please try again.');
  END IF;

  BEGIN
    v_idem_key := trim(p_idempotency_key)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'Invalid submission key. Please try again.');
  END;

  SELECT booking_ref INTO v_existing_ref
  FROM public.bookings
  WHERE idempotency_key = v_idem_key;

  IF FOUND THEN
    RETURN json_build_object(
      'success',      true,
      'duplicate',    true,
      'booking_ref',  v_existing_ref,
      'message',      'This enquiry has already been submitted.'
    );
  END IF;

  SELECT a.id, a.name, a.base_price_cents, COALESCE(a.currency, 'USD')
  INTO v_act_id, v_act_name, v_act_base, v_act_currency
  FROM public.activities a
  WHERE a.id = p_activity_id AND a.active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Activity not found or unavailable.');
  END IF;

  SELECT ap.price_cents, ap.pricing_unit, COALESCE(ap.currency, v_act_currency, 'USD')
  INTO v_pricing_cents, v_pricing_unit, v_pricing_currency
  FROM public.activity_pricing ap
  WHERE ap.activity_id = v_act_id
    AND ap.label = trim(p_pricing_option_label);

  IF NOT FOUND THEN
    v_pricing_cents := v_act_base;
    v_pricing_unit  := 'per_person';
    v_pricing_currency := v_act_currency;
  END IF;

  IF v_pricing_unit = 'per_person' THEN
    v_estimated := v_pricing_cents * v_total_guests;
  ELSE
    v_estimated := v_pricing_cents;
  END IF;

  v_exchange_rate := 18;

  IF v_pricing_currency = 'USD' THEN
    v_converted_usd := v_estimated;
    v_converted_mvr := ROUND(v_estimated * v_exchange_rate);
  ELSE
    v_converted_mvr := v_estimated;
    v_converted_usd := ROUND(v_estimated / v_exchange_rate);
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(v_phone_clean, '[^0-9]', '', 'g')
    AND regexp_replace(lower(trim(c.full_name)), '\s+', ' ', 'g')
      = regexp_replace(lower(v_name_clean), '\s+', ' ', 'g')
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.customers (full_name, phone)
    VALUES (v_name_clean, v_phone_clean)
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.bookings (
    customer_id, activity_id, source, status, guests, adults, children_count,
    booking_date, preferred_time, hotel_name, room_number, pickup_location,
    pricing_option_label, pricing_option_cents, estimated_total_cents,
    special_requests, idempotency_key, guest_agreed, guest_agreed_at,
    agreement_version, booking_currency, exchange_rate_mvr_per_usd,
    converted_usd_cents, converted_mvr_laari
  ) VALUES (
    v_customer_id, v_act_id, 'online'::booking_source, 'pending'::booking_status,
    v_total_guests, p_adults, p_children, v_booking_date,
    NULLIF(trim(p_preferred_time), ''), v_hotel_clean, v_room_clean,
    NULLIF(trim(p_pickup_location), ''), trim(p_pricing_option_label),
    v_pricing_cents, v_estimated, NULLIF(trim(p_special_requests), ''),
    v_idem_key, true, now(), 'booking-enquiry-v1',
    COALESCE(v_pricing_currency, 'USD'), v_exchange_rate,
    v_converted_usd, v_converted_mvr
  )
  RETURNING booking_ref INTO v_booking_ref;

  RETURN json_build_object(
    'success',               true,
    'booking_ref',           v_booking_ref,
    'activity_name',         v_act_name,
    'pricing_option',        trim(p_pricing_option_label),
    'date',                  v_booking_date::TEXT,
    'time',                  COALESCE(NULLIF(trim(p_preferred_time), ''), 'Flexible'),
    'adults',                p_adults,
    'children',              p_children,
    'hotel_room',            CASE
                               WHEN v_hotel_clean IS NOT NULL THEN
                                 v_hotel_clean || COALESCE(' / ' || v_room_clean, '')
                               ELSE E'\u2014'
                             END,
    'pickup',                COALESCE(NULLIF(trim(p_pickup_location), ''), E'\u2014'),
    'estimated_total_cents', v_estimated,
    'guest_name',            v_name_clean,
    'booking_currency',      COALESCE(v_pricing_currency, 'USD'),
    'exchange_rate',         v_exchange_rate,
    'converted_usd_cents',   v_converted_usd,
    'converted_mvr_laari',   v_converted_mvr
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO anon;

-- =============================================
-- 7. TOMORROW BOOKINGS REPORT
-- =============================================

CREATE OR REPLACE FUNCTION public.get_tomorrow_bookings()
RETURNS JSON AS $$
DECLARE
  v_role      staff_role;
  v_staff_id  UUID;
  v_tomorrow  DATE;
  v_result    JSON;
BEGIN
  v_staff_id := public.current_staff_id();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  v_role := public.current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, or reception.';
  END IF;

  v_tomorrow := (now() AT TIME ZONE 'Indian/Maldives')::DATE + INTERVAL '1 day';

  SELECT json_build_object(
    'date', v_tomorrow::TEXT,
    'bookings', COALESCE(
      (
        SELECT json_agg(json_build_object(
          'booking_ref',           b.booking_ref,
          'status',                b.status::TEXT,
          'activity_name',         a.name,
          'guest_name',            c.full_name,
          'guest_phone',           c.phone,
          'adults',                b.adults,
          'children',              b.children_count,
          'guests',                b.guests,
          'booking_date',          b.booking_date::TEXT,
          'preferred_time',        b.preferred_time,
          'hotel_name',            b.hotel_name,
          'room_number',           b.room_number,
          'pickup_location',       b.pickup_location,
          'pricing_option',        b.pricing_option_label,
          'estimated_total_cents', b.estimated_total_cents,
          'total_cents',           b.total_cents,
          'payment_status',        b.payment_status::TEXT,
          'special_requests',      b.special_requests,
          'source',                b.source::TEXT,
          'created_at',            b.created_at::TEXT,
          'booking_currency',      b.booking_currency,
          'exchange_rate',         b.exchange_rate_mvr_per_usd,
          'converted_usd_cents',   b.converted_usd_cents,
          'converted_mvr_laari',   b.converted_mvr_laari
        ))
        FROM public.bookings b
        JOIN public.activities a ON a.id = b.activity_id
        JOIN public.customers c ON c.id = b.customer_id
        WHERE b.booking_date = v_tomorrow
          AND b.status != 'cancelled'
        ORDER BY b.preferred_time NULLS LAST, b.created_at
      ),
      '[]'::JSON
    ),
    'summary', (
      SELECT json_build_object(
        'total',              COUNT(*),
        'confirmed',          COUNT(*) FILTER (WHERE status = 'confirmed'),
        'pending',            COUNT(*) FILTER (WHERE status = 'pending'),
        'total_adults',       COALESCE(SUM(adults), 0),
        'total_children',     COALESCE(SUM(children_count), 0),
        'total_guests',       COALESCE(SUM(guests), 0),
        'total_usd_cents',    COALESCE(SUM(converted_usd_cents), 0),
        'total_mvr_laari',    COALESCE(SUM(converted_mvr_laari), 0),
        'by_currency', (
          SELECT COALESCE(json_object_agg(bc, json_build_object(
            'count', bc_summary.cnt,
            'total_minor', bc_summary.total_minor
          )), '{}'::JSON)
          FROM (
            SELECT booking_currency AS bc,
                   COUNT(*) AS cnt,
                   SUM(estimated_total_cents) AS total_minor
            FROM public.bookings
            WHERE booking_date = v_tomorrow
              AND status != 'cancelled'
            GROUP BY booking_currency
          ) bc_summary
        )
      )
      FROM public.bookings
      WHERE booking_date = v_tomorrow
        AND status != 'cancelled'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_tomorrow_bookings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tomorrow_bookings() TO authenticated;

-- =============================================
-- 8. ATOMIC PAYMENT RECORDING RPC
-- =============================================
-- Records a payment and atomically recalculates booking payment_status.
--
-- SECURITY:
--   - Currency validated server-side (assertCurrency logic in SQL)
--   - booking_currency snapshotted from the booking row, never from client
--   - Row-level lock (FOR UPDATE) prevents race conditions
--   - Overpayment rejected: total paid cannot exceed payable total
--   - Only completed payments counted toward totals
--
-- PAYABLE TOTAL LOGIC:
--   If total_cents > 0 (staff-set final amount), use it.
--   Otherwise fall back to estimated_total_cents.
--
-- SIGNATURE: create_booking_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT)
-- REVOKE: ALL from PUBLIC and anon
-- GRANT: authenticated only

CREATE OR REPLACE FUNCTION public.create_booking_payment(
  p_booking_id    UUID,
  p_amount_cents  INT,
  p_currency      TEXT,
  p_method        TEXT DEFAULT 'cash',
  p_reference     TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_staff_id UUID;
  v_booking RECORD;
  v_payment_currency TEXT;
  v_converted INT;
  v_new_total_paid INT;
  v_new_status payment_status;
  v_payment_id UUID;
  v_payable_total INT;
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

  -- Determine payable total: total_cents if staff-set, otherwise estimated
  IF v_booking.total_cents > 0 THEN
    v_payable_total := v_booking.total_cents;
  ELSE
    v_payable_total := v_booking.estimated_total_cents;
  END IF;

  -- Sum only completed payments
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.booking_id = p_booking_id
    AND p2.status = 'completed';

  -- Reject overpayment
  IF v_new_total_paid + v_converted > v_payable_total AND v_payable_total > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Overpayment: this payment %s %s + already paid %s %s would exceed total %s %s.',
        (v_converted / 100.0)::NUMERIC(12,2), v_booking.booking_currency,
        (v_new_total_paid / 100.0)::NUMERIC(12,2), v_booking.booking_currency,
        (v_payable_total / 100.0)::NUMERIC(12,2), v_booking.booking_currency
      );
  END IF;

  -- Insert payment with booking_currency snapshot
  INSERT INTO public.payments (
    booking_id, amount_cents, currency, method, reference, notes,
    recorded_by, booking_rate_snapshot, converted_amount_cents,
    booking_currency, status
  ) VALUES (
    p_booking_id, p_amount_cents, v_payment_currency, p_method,
    NULLIF(TRIM(p_reference), ''), NULLIF(TRIM(p_notes), ''),
    v_staff_id, v_booking.exchange_rate_mvr_per_usd, v_converted,
    v_booking.booking_currency, 'completed'
  )
  RETURNING id INTO v_payment_id;

  -- Recalculate total paid (completed payments only)
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_new_total_paid
  FROM public.payments p2
  WHERE p2.booking_id = p_booking_id
    AND p2.status = 'completed';

  IF v_new_total_paid <= 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_new_total_paid >= v_payable_total THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE public.bookings
  SET payment_status = v_new_status,
      updated_at = now()
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
    'total_cents', v_booking.total_cents
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.create_booking_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_booking_payment(UUID, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================
-- 9. PAYMENT SUMMARY FOR BOOKING
-- =============================================
-- Uses completed-payments-only filtering and payable total logic.

CREATE OR REPLACE FUNCTION public.get_booking_payment_summary(p_booking_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_booking RECORD;
  v_total_paid INT;
  v_payable_total INT;
  v_result JSON;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  -- Only count completed payments
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0)
  INTO v_total_paid
  FROM public.payments p2
  WHERE p2.booking_id = p_booking_id
    AND p2.status = 'completed';

  -- Payable total: total_cents if staff-set, otherwise estimated
  IF v_booking.total_cents > 0 THEN
    v_payable_total := v_booking.total_cents;
  ELSE
    v_payable_total := v_booking.estimated_total_cents;
  END IF;

  v_result := json_build_object(
    'booking_id', v_booking.id,
    'booking_currency', v_booking.booking_currency,
    'payable_total_cents', v_payable_total,
    'estimated_total_cents', v_booking.estimated_total_cents,
    'total_cents', v_booking.total_cents,
    'total_paid_cents', v_total_paid,
    'remaining_cents', GREATEST(v_payable_total - v_total_paid, 0),
    'payment_status', v_booking.payment_status::TEXT,
    'exchange_rate', v_booking.exchange_rate_mvr_per_usd
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.get_booking_payment_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_payment_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_summary(UUID) TO authenticated;

-- =============================================
-- 10. RPC SECURITY REPORT
-- =============================================
-- Exact signatures, permissions, and security model for migration 008.
--
-- ┌──────────────────────────────────────────────────────────────────┐
-- │ RPC                          │ REVOKE      │ GRANT       │ Auth │
-- ├──────────────────────────────────────────────────────────────────┤
-- │ submit_public_booking(       │ PUBLIC      │ anon        │ No   │
-- │   UUID,TEXT,TEXT,TEXT,TEXT,   │             │             │      │
-- │   TEXT,INT,INT,TEXT,TEXT,    │             │             │      │
-- │   TEXT,TEXT,TEXT,BOOLEAN)    │             │             │      │
-- ├──────────────────────────────────────────────────────────────────┤
-- │ get_tomorrow_bookings()      │ PUBLIC      │ authenticated│ Yes  │
-- ├──────────────────────────────────────────────────────────────────┤
-- │ create_booking_payment(      │ PUBLIC,anon │ authenticated│ Yes  │
-- │   UUID,INT,TEXT,TEXT,TEXT,   │             │             │      │
-- │   TEXT)                      │             │             │      │
-- ├──────────────────────────────────────────────────────────────────┤
-- │ get_booking_payment_summary( │ PUBLIC,anon │ authenticated│ Yes  │
-- │   UUID)                      │             │             │      │
-- └──────────────────────────────────────────────────────────────────┘
--
-- All functions are SECURITY DEFINER with SET search_path = public.
-- All authenticated RPCs use current_staff_id()/current_staff_role() helpers.
-- Payment currency validated server-side, never trusts client input.
-- Booking currency snapshotted into payments.booking_currency.
-- Row-level lock (FOR UPDATE) in create_booking_payment prevents races.
-- Overpayment rejected when total_paid + new > payable_total.
-- Only completed payments counted toward totals (payments.status = 'completed').
