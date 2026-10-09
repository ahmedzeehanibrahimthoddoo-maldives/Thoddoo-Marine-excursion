-- =============================================
-- Thoddoo Marine – Public Booking Workflow 007
-- Adds public-booking columns and submit RPC
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 1. ADD COLUMNS TO BOOKINGS
-- =============================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS preferred_time TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adults INT DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS children_count INT DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hotel_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_number TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_location TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_option_label TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_option_cents INT DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_total_cents INT DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_agreed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_agreed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreement_version TEXT;

-- Idempotency: unique constraint on UUID (NULLs are distinct in PostgreSQL)
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT uq_bookings_idempotency_key UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Index for tomorrow's report queries
CREATE INDEX IF NOT EXISTS idx_bookings_booking_date ON bookings(booking_date);

-- =============================================
-- 2. ADD PRICING UNIT TO ACTIVITY PRICING
-- =============================================
-- pricing_unit controls how estimated_total is calculated:
--   'per_person'  → price × total guests (e.g. manta snorkeling $75 × 2)
--   'per_unit'    → flat price for the option (e.g. funtube 2-person $55 flat)
--   'per_hour'    → flat price per hour (e.g. kayak $10/hour)

ALTER TABLE activity_pricing ADD COLUMN IF NOT EXISTS pricing_unit TEXT;

-- Constrain to known values (NOT NULL enforced after backfill)
DO $$ BEGIN
  ALTER TABLE activity_pricing
    ADD CONSTRAINT chk_pricing_unit
    CHECK (pricing_unit IN ('per_person', 'per_unit', 'per_hour'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 2a. PRICING UNIT BACKFALL — all 20 seeded rows
-- =============================================
-- Adventures (manta-ray-snorkeling, nurse-shark-adventure, manta-nurse-shark-combo,
--   sandbank-trip, dolphin-cruise, turtle-reef-snorkeling) have NO activity_pricing rows.
--   The RPC fallback for no pricing row uses 'per_person' — correct for adventures.
-- Below: explicit backfill for all 20 watersports pricing rows from 003_seed.sql.

-- Jet Ski: per_session flat rate per ride
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'jet-ski');

-- Funtube: flat rate per configuration (2-person $55, 4-person $75)
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'funtube');

-- Banana Ride: flat rate per configuration (2-person $55, 4-person $75)
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'banana-ride');

-- Water Skiing: per-session flat rate
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'water-skiing');

-- Wakeboarding: per-session flat rate
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'wakeboarding');

-- Kayak: per_hour (single $10/hr, double $15/hr, transparent $30/hr)
UPDATE activity_pricing SET pricing_unit = 'per_hour'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'kayak');

-- Spatium Bike: flat rate per rider config (child $20, single $30, double $40)
UPDATE activity_pricing SET pricing_unit = 'per_unit'
WHERE activity_id IN (SELECT id FROM activities WHERE slug = 'spatium-bike');

-- Now enforce NOT NULL (safe: all rows have been assigned above, new rows get DEFAULT)
ALTER TABLE activity_pricing ALTER COLUMN pricing_unit SET NOT NULL;
ALTER TABLE activity_pricing ALTER COLUMN pricing_unit SET DEFAULT 'per_person';

-- =============================================
-- 3. REVOKE ANON ACCESS (belt and suspenders)
-- =============================================

REVOKE ALL ON bookings FROM anon;
REVOKE ALL ON customers FROM anon;

-- =============================================
-- 4. PUBLIC BOOKING SUBMISSION RPC
-- =============================================
-- SECURITY DEFINER: runs with owner perms
-- Validates all inputs, looks up activity/pricing from DB
-- Matches customer by phone AND name (conservative)
-- Never overwrites existing customer identity data
-- Creates booking with source='online', status='pending' (hardcoded)
-- Validates guest_agreed = true; records agreement_version
-- Returns booking_ref + safe confirmation (no IDs, no staff data)

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
  v_pricing_cents  INT;
  v_pricing_unit   TEXT;
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
BEGIN
  -- =============================================
  -- INPUT VALIDATION
  -- =============================================

  -- Agreement required (server-side enforcement)
  IF p_guest_agreed IS NOT TRUE THEN
    RETURN json_build_object('error', 'You must agree to the terms to submit a booking enquiry.');
  END IF;

  -- Activity ID
  IF p_activity_id IS NULL THEN
    RETURN json_build_object('error', 'Activity is required.');
  END IF;

  -- Guest name
  v_name_clean := trim(p_guest_name);
  IF v_name_clean IS NULL OR length(v_name_clean) < 2 THEN
    RETURN json_build_object('error', 'Full name is required (at least 2 characters).');
  END IF;
  IF length(v_name_clean) > 120 THEN
    RETURN json_build_object('error', 'Name must be 120 characters or fewer.');
  END IF;

  -- Guest phone
  v_phone_clean := regexp_replace(trim(p_guest_phone), '[^0-9+]', '', 'g');
  IF v_phone_clean IS NULL OR length(v_phone_clean) < 7 THEN
    RETURN json_build_object('error', 'A valid WhatsApp number with country code is required.');
  END IF;
  IF length(v_phone_clean) > 20 THEN
    RETURN json_build_object('error', 'Phone number is too long.');
  END IF;

  -- Adults
  IF p_adults IS NULL OR p_adults < 1 THEN
    RETURN json_build_object('error', 'At least 1 adult is required.');
  END IF;
  IF p_adults > 50 THEN
    RETURN json_build_object('error', 'Maximum 50 adults per booking.');
  END IF;

  -- Children
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

  -- Booking date — parse and validate
  BEGIN
    v_booking_date := trim(p_booking_date)::DATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'Invalid booking date format. Use YYYY-MM-DD.');
  END;

  IF v_booking_date IS NULL THEN
    RETURN json_build_object('error', 'Booking date is required.');
  END IF;

  -- Date must not be in the past (check against Maldives time UTC+5)
  IF v_booking_date < ((now() AT TIME ZONE 'Indian/Maldives')::DATE) THEN
    RETURN json_build_object('error', 'Booking date cannot be in the past.');
  END IF;

  -- Date must not be more than 365 days away
  IF v_booking_date > ((now() AT TIME ZONE 'Indian/Maldives')::DATE + INTERVAL '365 days') THEN
    RETURN json_build_object('error', 'Booking date must be within the next year.');
  END IF;

  -- Preferred time (optional, validate format HH:MM)
  IF p_preferred_time IS NOT NULL AND trim(p_preferred_time) != '' THEN
    IF trim(p_preferred_time) !~ '^\d{1,2}:\d{2}$' THEN
      RETURN json_build_object('error', 'Invalid time format. Use HH:MM (e.g. 09:00).');
    END IF;
  END IF;

  -- Hotel (optional length check)
  v_hotel_clean := NULLIF(trim(p_hotel_name), '');
  IF v_hotel_clean IS NOT NULL AND length(v_hotel_clean) > 120 THEN
    RETURN json_build_object('error', 'Hotel name must be 120 characters or fewer.');
  END IF;

  -- Room (optional length check)
  v_room_clean := NULLIF(trim(p_room_number), '');
  IF v_room_clean IS NOT NULL AND length(v_room_clean) > 30 THEN
    RETURN json_build_object('error', 'Room number must be 30 characters or fewer.');
  END IF;

  -- Pickup (optional length check)
  IF p_pickup_location IS NOT NULL AND length(trim(p_pickup_location)) > 120 THEN
    RETURN json_build_object('error', 'Pickup location must be 120 characters or fewer.');
  END IF;

  -- Special requests (optional length check)
  IF p_special_requests IS NOT NULL AND length(trim(p_special_requests)) > 500 THEN
    RETURN json_build_object('error', 'Special requests must be 500 characters or fewer.');
  END IF;

  -- Pricing option label (required)
  IF p_pricing_option_label IS NULL OR trim(p_pricing_option_label) = '' THEN
    RETURN json_build_object('error', 'Please select a pricing option.');
  END IF;

  -- Idempotency key — validate as UUID
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN json_build_object('error', 'Submission error. Please try again.');
  END IF;

  BEGIN
    v_idem_key := trim(p_idempotency_key)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'Invalid submission key. Please try again.');
  END;

  -- =============================================
  -- IDEMPOTENCY CHECK (before any writes)
  -- =============================================
  -- Return ONLY the booking_ref and a duplicate flag.
  -- Never return another guest's name, phone, hotel, etc.

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

  -- =============================================
  -- LOOKUP ACTIVITY (do not trust client)
  -- Schema-qualify for security in SECURITY DEFINER
  -- =============================================

  SELECT a.id, a.name, a.base_price_cents
  INTO v_act_id, v_act_name, v_act_base
  FROM public.activities a
  WHERE a.id = p_activity_id AND a.active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Activity not found or unavailable.');
  END IF;

  -- =============================================
  -- LOOKUP PRICING OPTION (do not trust client)
  -- =============================================
  -- pricing_unit determines calculation model:
  --   'per_person' → multiply by guests
  --   'per_unit' / 'per_hour' → flat rate for the option

  SELECT ap.price_cents, ap.pricing_unit
  INTO v_pricing_cents, v_pricing_unit
  FROM public.activity_pricing ap
  WHERE ap.activity_id = v_act_id
    AND ap.label = trim(p_pricing_option_label);

  IF NOT FOUND THEN
    -- No matching pricing row: use base price as per_person fallback
    v_pricing_cents := v_act_base;
    v_pricing_unit  := 'per_person';
  END IF;

  -- Calculate estimated total based on pricing unit
  IF v_pricing_unit = 'per_person' THEN
    v_estimated := v_pricing_cents * v_total_guests;
  ELSE
    -- per_unit, per_hour, or any future unit: flat rate
    v_estimated := v_pricing_cents;
  END IF;

  -- =============================================
  -- FIND OR CREATE CUSTOMER
  -- Conservative: match on phone AND normalized name
  -- Never overwrite identity data from anonymous submissions
  -- =============================================

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(v_phone_clean, '[^0-9]', '', 'g')
    AND regexp_replace(lower(trim(c.full_name)), '\s+', ' ', 'g')
      = regexp_replace(lower(v_name_clean), '\s+', ' ', 'g')
  LIMIT 1;

  IF NOT FOUND THEN
    -- Create new customer with only basic info
    -- Hotel/room stay on the booking record, not the customer profile
    INSERT INTO public.customers (full_name, phone)
    VALUES (v_name_clean, v_phone_clean)
    RETURNING id INTO v_customer_id;
  END IF;
  -- Note: we intentionally do NOT update hotel, room, name, email,
  -- medical or any identity fields on existing customers from
  -- anonymous submissions. Hotel/room are on the booking record.

  -- =============================================
  -- CREATE BOOKING
  -- source and status are HARDCODED — cannot be overridden
  -- agreement recorded server-side with controlled version
  -- =============================================

  INSERT INTO public.bookings (
    customer_id,
    activity_id,
    source,
    status,
    guests,
    adults,
    children_count,
    booking_date,
    preferred_time,
    hotel_name,
    room_number,
    pickup_location,
    pricing_option_label,
    pricing_option_cents,
    estimated_total_cents,
    special_requests,
    idempotency_key,
    guest_agreed,
    guest_agreed_at,
    agreement_version
  ) VALUES (
    v_customer_id,
    v_act_id,
    'online'::booking_source,
    'pending'::booking_status,
    v_total_guests,
    p_adults,
    p_children,
    v_booking_date,
    NULLIF(trim(p_preferred_time), ''),
    v_hotel_clean,
    v_room_clean,
    NULLIF(trim(p_pickup_location), ''),
    trim(p_pricing_option_label),
    v_pricing_cents,
    v_estimated,
    NULLIF(trim(p_special_requests), ''),
    v_idem_key,
    true,
    now(),
    'booking-enquiry-v1'
  )
  RETURNING booking_ref INTO v_booking_ref;

  -- =============================================
  -- RETURN SAFE CONFIRMATION
  -- No internal IDs, no customer UUID, no staff data
  -- =============================================

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
                               ELSE '—'
                             END,
    'pickup',                COALESCE(NULLIF(trim(p_pickup_location), ''), '—'),
    'estimated_total_cents', v_estimated,
    'guest_name',            v_name_clean
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 5. REVOKE & GRANT EXECUTE
-- =============================================

REVOKE ALL ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_public_booking(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO anon;

-- =============================================
-- 6. TOMORROW'S BOOKINGS REPORT RPC
-- =============================================
-- SECURITY DEFINER with explicit role guard
-- Returns only operationally required fields
-- Never returns: passport, medical, allergies, medications,
--   signatures, tokens, UUIDs, audit data

CREATE OR REPLACE FUNCTION public.get_tomorrow_bookings()
RETURNS JSON AS $$
DECLARE
  v_role      staff_role;
  v_staff_id  UUID;
  v_tomorrow  DATE;
  v_result    JSON;
BEGIN
  -- =============================================
  -- AUTHORIZATION GUARD
  -- =============================================
  -- Must be authenticated with a registered staff profile
  v_staff_id := public.current_staff_id();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  -- Must have an authorized role
  v_role := public.current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, or reception.';
  END IF;

  -- =============================================
  -- TOMORROW IN MALDIVES TIME (UTC+5)
  -- =============================================
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
          'created_at',            b.created_at::TEXT
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
        'total',          COUNT(*),
        'confirmed',      COUNT(*) FILTER (WHERE status = 'confirmed'),
        'pending',        COUNT(*) FILTER (WHERE status = 'pending'),
        'total_adults',   COALESCE(SUM(adults), 0),
        'total_children', COALESCE(SUM(children_count), 0),
        'total_guests',   COALESCE(SUM(guests), 0)
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
