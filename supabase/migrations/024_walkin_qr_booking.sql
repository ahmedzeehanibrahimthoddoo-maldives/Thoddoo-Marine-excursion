-- =============================================
-- 024: WALK-IN QR BOOKING
--      Add p_source to submit_public_booking
-- =============================================
-- The public booking form creates bookings with source = 'online'.
-- This migration lets the walk-in QR flow create bookings marked
-- as 'walk_in' so staff can pick them out of the queue and process
-- payment/consent. Backward compatible: existing callers that omit
-- p_source default to 'online'.
--
-- The old 14-arg overload (no p_source) is dropped so PostgREST can
-- resolve a single unambiguous function. The new version keeps the
-- exact same 14 params (plus a defaulted 15th), so all existing
-- callers keep working.
-- =============================================

DROP FUNCTION IF EXISTS public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
);

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
  p_guest_agreed        BOOLEAN,
  p_source              TEXT DEFAULT 'online'
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
  v_source         booking_source;
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

  -- Source whitelist: online (website), walk_in (on-site QR), whatsapp (manual)
  v_source := COALESCE(NULLIF(trim(COALESCE(p_source, 'online')), ''), 'online')::booking_source;
  IF v_source NOT IN ('online', 'walk_in', 'whatsapp') THEN
    RETURN json_build_object('error', 'Invalid booking source.');
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
    v_customer_id, v_act_id, v_source, 'pending'::booking_status,
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
    'converted_mvr_laari',   v_converted_mvr,
    'source',                v_source::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO anon;