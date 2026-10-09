-- =============================================
-- Migration 040: Grouped (multi-activity) bookings
-- =============================================
-- A guest can book several activities in one go. Each activity remains
-- its own booking row (so trips, manifests, consent and payments keep
-- working unchanged) but they share a booking group, which lets staff
-- confirm and take a combined payment at once.
--
-- Adds: booking_groups table + bookings.group_id
-- Adds: submit_public_booking_group(...) — anon-callable, creates one
--       customer, one group and N bookings atomically.
-- Does NOT modify migrations 001–039.
-- =============================================

BEGIN;

-- =============================================
-- 1. BOOKING GROUPS
-- =============================================
CREATE TABLE IF NOT EXISTS public.booking_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_ref TEXT NOT NULL UNIQUE,
  idempotency_key TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  source booking_source NOT NULL DEFAULT 'online',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_groups_idempotency
  ON public.booking_groups (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.booking_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_group ON public.bookings(group_id);

-- Staff can read groups; writes happen only through SECURITY DEFINER RPCs.
ALTER TABLE public.booking_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_groups_staff_select ON public.booking_groups;
CREATE POLICY booking_groups_staff_select ON public.booking_groups
  FOR SELECT TO authenticated
  USING (public.current_staff_role() IS NOT NULL);

GRANT SELECT ON public.booking_groups TO authenticated;
REVOKE ALL ON public.booking_groups FROM anon;

-- =============================================
-- 2. GROUP REF GENERATOR
-- =============================================
CREATE SEQUENCE IF NOT EXISTS public.booking_group_ref_seq START 1001;

-- =============================================
-- 3. SUBMIT GROUPED BOOKING (anon)
-- =============================================
CREATE OR REPLACE FUNCTION public.submit_public_booking_group(
  p_items               JSONB,   -- [{"activity_id":"<uuid>","pricing_option_label":"..."}]
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
  v_src            booking_source;
  v_name_clean     TEXT;
  v_phone_clean    TEXT;
  v_total_guests   INT;
  v_booking_date   DATE;
  v_hotel_clean    TEXT;
  v_room_clean     TEXT;
  v_idem_key       UUID;
  v_group_id       UUID;
  v_group_ref      TEXT;
  v_existing_ref   TEXT;
  v_customer_id    UUID;
  v_item           JSONB;
  v_resolved       JSONB := '[]'::jsonb;
  v_results        JSONB := '[]'::jsonb;
  v_idx            INT := 0;
  v_act_id         UUID;
  v_act_name       TEXT;
  v_act_base       INT;
  v_act_currency   TEXT;
  v_pricing_label  TEXT;
  v_pricing_cents  INT;
  v_pricing_unit   TEXT;
  v_pricing_currency TEXT;
  v_estimated      INT;
  v_exchange_rate  NUMERIC(10,4) := 18;
  v_converted_usd  INT;
  v_converted_mvr  INT;
  v_booking_ref    TEXT;
  v_booking_id     UUID;
  v_item_key       UUID;
BEGIN
  IF p_guest_agreed IS NOT TRUE THEN
    RETURN json_build_object('error', 'You must agree to the terms to submit a booking enquiry.');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', 'Please choose at least one activity.');
  END IF;
  IF jsonb_array_length(p_items) > 8 THEN
    RETURN json_build_object('error', 'You can combine up to 8 activities in one booking.');
  END IF;

  v_src := COALESCE(NULLIF(trim(COALESCE(p_source, 'online')), ''), 'online')::booking_source;
  IF v_src NOT IN ('online', 'walk_in', 'whatsapp') THEN
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

  IF p_preferred_time IS NOT NULL AND trim(p_preferred_time) != ''
     AND trim(p_preferred_time) !~ '^\d{1,2}:\d{2}$' THEN
    RETURN json_build_object('error', 'Invalid time format. Use HH:MM (e.g. 09:00).');
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

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN json_build_object('error', 'Submission error. Please try again.');
  END IF;
  BEGIN
    v_idem_key := trim(p_idempotency_key)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'Invalid submission key. Please try again.');
  END;

  SELECT group_ref INTO v_existing_ref
  FROM public.booking_groups
  WHERE idempotency_key = trim(p_idempotency_key);
  IF FOUND THEN
    RETURN json_build_object(
      'success', true, 'duplicate', true, 'group_ref', v_existing_ref,
      'message', 'This enquiry has already been submitted.'
    );
  END IF;

  -- Pre-resolve every item so a bad activity/price aborts before any write.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_idx := v_idx + 1;
    IF (v_item->>'activity_id') IS NULL OR trim(v_item->>'activity_id') = '' THEN
      RETURN json_build_object('error', format('Activity is required for item %s.', v_idx));
    END IF;
    BEGIN
      v_act_id := (v_item->>'activity_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', format('Invalid activity for item %s.', v_idx));
    END;
    v_pricing_label := NULLIF(trim(v_item->>'pricing_option_label'), '');
    IF v_pricing_label IS NULL THEN
      RETURN json_build_object('error', format('Please select a pricing option for item %s.', v_idx));
    END IF;

    SELECT a.id, a.name, a.base_price_cents, COALESCE(a.currency, 'USD')
    INTO v_act_id, v_act_name, v_act_base, v_act_currency
    FROM public.activities a
    WHERE a.id = v_act_id AND a.active = true;
    IF NOT FOUND THEN
      RETURN json_build_object('error', format('Activity not found or unavailable for item %s.', v_idx));
    END IF;

    SELECT ap.price_cents, ap.pricing_unit, COALESCE(ap.currency, v_act_currency, 'USD')
    INTO v_pricing_cents, v_pricing_unit, v_pricing_currency
    FROM public.activity_pricing ap
    WHERE ap.activity_id = v_act_id AND ap.label = v_pricing_label;
    IF NOT FOUND THEN
      v_pricing_cents := v_act_base;
      v_pricing_unit := 'per_person';
      v_pricing_currency := v_act_currency;
    END IF;

    IF v_pricing_unit = 'per_person' THEN
      v_estimated := v_pricing_cents * v_total_guests;
    ELSE
      v_estimated := v_pricing_cents;
    END IF;

    IF v_pricing_currency = 'USD' THEN
      v_converted_usd := v_estimated;
      v_converted_mvr := ROUND(v_estimated * v_exchange_rate);
    ELSE
      v_converted_mvr := v_estimated;
      v_converted_usd := ROUND(v_estimated / v_exchange_rate);
    END IF;

    v_resolved := v_resolved || jsonb_build_object(
      'activity_id', v_act_id,
      'activity_name', v_act_name,
      'pricing_option_label', v_pricing_label,
      'pricing_option_cents', v_pricing_cents,
      'estimated_total_cents', v_estimated,
      'currency', v_pricing_currency,
      'converted_usd_cents', v_converted_usd,
      'converted_mvr_laari', v_converted_mvr
    );
  END LOOP;

  -- One shared customer for the whole party.
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

  v_group_ref := 'OBG-' || to_char((now() AT TIME ZONE 'Indian/Maldives'), 'YYMMDD')
    || '-' || lpad(nextval('public.booking_group_ref_seq')::TEXT, 4, '0');

  INSERT INTO public.booking_groups (group_ref, idempotency_key, customer_id, source)
  VALUES (v_group_ref, trim(p_idempotency_key), v_customer_id, v_src)
  RETURNING id INTO v_group_id;

  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_resolved) LOOP
    v_idx := v_idx + 1;
    v_item_key := md5(trim(p_idempotency_key) || ':' || v_idx)::UUID;

    INSERT INTO public.bookings (
      customer_id, activity_id, source, status, guests, adults, children_count,
      booking_date, preferred_time, hotel_name, room_number, pickup_location,
      pricing_option_label, pricing_option_cents, estimated_total_cents,
      special_requests, idempotency_key, guest_agreed, guest_agreed_at,
      agreement_version, booking_currency, exchange_rate_mvr_per_usd,
      converted_usd_cents, converted_mvr_laari, group_id
    ) VALUES (
      v_customer_id,
      (v_item->>'activity_id')::UUID,
      v_src, 'pending'::booking_status,
      v_total_guests, p_adults, p_children, v_booking_date,
      NULLIF(trim(p_preferred_time), ''), v_hotel_clean, v_room_clean,
      NULLIF(trim(p_pickup_location), ''),
      v_item->>'pricing_option_label',
      (v_item->>'pricing_option_cents')::INT,
      (v_item->>'estimated_total_cents')::INT,
      NULLIF(trim(p_special_requests), ''),
      v_item_key, true, now(), 'booking-enquiry-v1',
      COALESCE(v_item->>'currency', 'USD'), v_exchange_rate,
      (v_item->>'converted_usd_cents')::INT,
      (v_item->>'converted_mvr_laari')::INT,
      v_group_id
    )
    RETURNING id, booking_ref INTO v_booking_id, v_booking_ref;

    v_results := v_results || jsonb_build_object(
      'booking_id', v_booking_id,
      'booking_ref', v_booking_ref,
      'activity_id', v_item->>'activity_id',
      'activity_name', v_item->>'activity_name',
      'pricing_option', v_item->>'pricing_option_label',
      'estimated_total_cents', (v_item->>'estimated_total_cents')::INT,
      'booking_currency', v_item->>'currency'
    );
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'group_id', v_group_id,
    'group_ref', v_group_ref,
    'guest_name', v_name_clean,
    'date', v_booking_date::TEXT,
    'time', COALESCE(NULLIF(trim(p_preferred_time), ''), 'Flexible'),
    'adults', p_adults,
    'children', p_children,
    'item_count', jsonb_array_length(v_results),
    'items', v_results,
    'source', v_src::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_public_booking_group(
  JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_public_booking_group(
  JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO anon;

COMMIT;
