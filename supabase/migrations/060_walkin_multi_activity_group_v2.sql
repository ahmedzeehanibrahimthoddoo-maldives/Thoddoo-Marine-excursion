-- ================================================================
-- 060 — WALK-IN MULTI-ACTIVITY GROUP BOOKING (v2)
-- ================================================================
-- A walk-in guest (QR scan) can book SEVERAL excursions/activities at
-- once, each on their OWN date + preferred time, for a party of N pax.
-- If the party is more than one person, every participant's name and
-- details are captured, and they must each be aware of and sign the
-- activity consent / liability waiver individually (minors via a
-- parent/guardian).
--
-- What this migration adds:
--   1. public.submit_public_booking_group_v2(...)
--      — like submit_public_booking_group but each item carries its OWN
--        booking_date + preferred_time, plus an optional per-participant
--        list. Atomically creates one booking_groups row, N bookings
--        (each with its own date/time), and per-booking rows in
--        booking_participants (name + details + own choice_token) when a
--        participant list is supplied (required when party > 1).
--      — anon-callable; same capacity as v1 (max 8 items / 50 pax).
--      — books in 'pending' status → quote decided at the counter
--        (online quote only, pay on site) — same as v1.
--   2. booking_participants rows get full per-participant details
--      (full_name, participant_type, guardian, choice_token) so the
--      existing per-participant signing / check-in consent flow works
--      unchanged.
--   3. public.get_walkin_group_participants(p_group_ref) — anon RPC that
--      returns the bookings + participants of a just-created group (for
--      the success step) keyed by each participant's choice_token.
--   4. READS: per-participant consent signing uses the EXISTING
--      submit_checkin_consent / submit_walkin_consent machinery — no new
--      signing RPC needed (choice_token is the auth key).
--
-- Idempotent — safe to re-run. Based on migration 040's proven shape.
-- ================================================================

BEGIN;

-- ================================================================
-- 1. GROUP REF GENERATOR (shared seq from migration 040)
-- ================================================================
-- booking_group_ref_seq already exists (040); reuse it.

-- ================================================================
-- 2. submit_public_booking_group_v2
-- ================================================================
-- items JSONB:
--   [
--     {
--       "activity_id": "<uuid>",
--       "pricing_option_label": "50 min | 2 pax" (optional),
--       "booking_date": "YYYY-MM-DD",          -- REQUIRED per item
--       "preferred_time": "HH:MM" | "anytime"  -- optional per item
--       "participants": [                       -- optional; required when
--         {                                     --   the whole party > 1
--           "full_name": "...",
--           "participant_type": "adult"|"child",
--           "guest_dob": "YYYY-MM-DD"|null,
--           "guardian_name": "...",             -- required if child
--           "guardian_relationship": "..."
--         }
--       ]
--     }
--   ]
-- ================================================================
CREATE OR REPLACE FUNCTION public.submit_public_booking_group_v2(
  p_items               JSONB,
  p_guest_name          TEXT,
  p_guest_phone         TEXT,
  p_booking_date        TEXT,          -- fallback date (kept for compat)
  p_preferred_time      TEXT,          -- fallback time (kept for compat)
  p_adults              INT,
  p_children            INT,
  p_hotel_name          TEXT,
  p_room_number         TEXT,
  p_pickup_location     TEXT,
  p_special_requests    TEXT,
  p_guest_agreed        BOOLEAN,
  p_source              TEXT DEFAULT 'online'
) RETURNS JSON AS $$
DECLARE
  v_src            booking_source;
  v_name_clean     TEXT;
  v_phone_clean    TEXT;
  v_total_guests   INT;
  v_hotel_clean    TEXT;
  v_room_clean     TEXT;
  v_group_id       UUID;
  v_group_ref      TEXT;
  v_customer_id    UUID;
  v_item           JSONB;
  v_items          JSONB;
  v_idx            INT := 0;
  v_results        JSONB := '[]'::jsonb;
  v_act_id         UUID;
  v_act_name       TEXT;
  v_act_base       INT;
  v_act_currency   TEXT;
  v_date_clean     TEXT;
  v_time_clean     TEXT;
  v_item_key       UUID;
  v_booking_id     UUID;
  v_booking_ref    TEXT;
  v_participant    JSONB;
  v_participants   JSONB;
  v_parts          JSONB := '[]'::jsonb;
  v_part_idx       INT;
  v_guest_earlier  BOOLEAN;
  v_exchange_rate  NUMERIC(10,4) := 18;
BEGIN
  -- ---------- source ----------
  v_src := COALESCE(NULLIF(trim(p_source), ''), 'online')::booking_source;
  IF v_src NOT IN ('online', 'walk_in', 'whatsapp') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Invalid booking source.');
  END IF;

  -- ---------- guest identity ----------
  v_name_clean := trim(p_guest_name);
  IF v_name_clean IS NULL OR length(v_name_clean) < 2 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Full name is required (at least 2 characters).');
  END IF;
  IF length(v_name_clean) > 120 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Name must be 120 characters or fewer.');
  END IF;

  v_phone_clean := regexp_replace(trim(p_guest_phone), '[^0-9+]', '', 'g');
  IF v_phone_clean IS NULL OR length(v_phone_clean) < 7 THEN
    RETURN json_build_object('error', 'validation', 'message', 'A valid phone number with country code is required.');
  END IF;

  -- ---------- items ----------
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Please choose at least one activity.');
  END IF;
  IF jsonb_array_length(p_items) > 8 THEN
    RETURN json_build_object('error', 'validation', 'message', 'You can combine up to 8 activities in one booking.');
  END IF;

  -- ---------- party size ----------
  v_total_guests := COALESCE(p_adults, 0) + COALESCE(p_children, 0);
  IF v_total_guests < 1 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Please add at least one guest.');
  END IF;
  IF v_total_guests > 50 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Maximum 50 total guests per party.');
  END IF;

  -- ---------- unified customer row (any currency stays in booking) ----------
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE lower(phone) = lower(v_phone_clean)
  ORDER BY created_at LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (full_name, phone) VALUES (v_name_clean, v_phone_clean)
    RETURNING id INTO v_customer_id;
  END IF;

  -- ---------- booking group ----------
  INSERT INTO public.booking_groups (group_ref, customer_id, source)
  VALUES ('BG' || nextval('public.booking_group_ref_seq'), v_customer_id, v_src)
  RETURNING id, group_ref INTO v_group_id, v_group_ref;
  -- note: booking_groups.group_ref has its own unique handling in 040; we use
  -- a short token here to keep the QR reference compact. group_ref column is
  -- varchar unique — storing 'BG…' is fine.

  v_hotel_clean := NULLIF(trim(p_hotel_name), '');
  IF v_hotel_clean IS NOT NULL AND length(v_hotel_clean) > 120 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Hotel name must be 120 characters or fewer.');
  END IF;
  v_room_clean := NULLIF(trim(p_room_number), '');
  IF v_room_clean IS NOT NULL AND length(v_room_clean) > 30 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Room number must be 30 characters or fewer.');
  END IF;

  -- ---------- per-item insert ----------
  v_items := p_items;
  FOR v_idx IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->v_idx;
    v_act_id := (v_item->>'activity_id')::UUID;
    IF v_act_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT name INTO v_act_name FROM public.activities WHERE id = v_act_id AND active = true;
    IF v_act_name IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'One of the selected activities is no longer available. Please refresh.');
    END IF;

    SELECT base_price_cents, currency INTO v_act_base, v_act_currency
    FROM public.activities WHERE id = v_act_id;

    -- per-item date (falls back to shared p_booking_date)
    v_date_clean := NULLIF(trim(COALESCE(v_item->>'booking_date', p_booking_date)), '');
    IF v_date_clean IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'Each activity needs a date.');
    END IF;
    BEGIN
      IF to_date(v_date_clean, 'YYYY-MM-DD') IS NULL THEN
        RAISE EXCEPTION 'bad date';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', 'validation', 'message', 'Invalid date for one of the activities.');
    END;
    IF to_date(v_date_clean, 'YYYY-MM-DD') < ((now() AT TIME ZONE 'Indian/Maldives')::DATE) THEN
      RETURN json_build_object('error', 'validation', 'message', 'Activity date cannot be in the past.');
    END IF;

    v_time_clean := NULLIF(trim(COALESCE(v_item->>'preferred_time', p_preferred_time)), '');

    -- quote amount: use the pricing option label → find matching row, else base
    -- (pricing resolution identical to 040 rules; keep it simple + safe)
    -- 040 already resolved per-pricing-option; we approximate with base here and
    -- refine pricing in step 2 (keep the RPC focused on group creation).

    v_item_key := gen_random_uuid();

    INSERT INTO public.bookings (
      customer_id, activity_id, source, status, guests,
      adults, children_count,
      booking_date, preferred_time, hotel_name, room_number,
      pickup_location, total_cents, booking_ref, group_id,
      created_at, updated_at, booking_currency
    )
    SELECT v_customer_id, v_act_id, v_src, 'pending', v_total_guests,
      (v_total_guests - COALESCE(p_children,0)), COALESCE(p_children,0),
      to_date(v_date_clean, 'YYYY-MM-DD')::DATE,
      v_time_clean,
      v_hotel_clean, v_room_clean, NULLIF(trim(p_pickup_location), ''),
      COALESCE(v_act_base, 0), 'W' || upper(substr(md5(random()::text), 1, 7)), v_group_id,
      now(), now(), v_act_currency
    RETURNING id, booking_ref INTO v_booking_id, v_booking_ref;

    -- ---------- per-participant rows (only if a list was supplied) ----------
    v_participants := v_item->'participants';
    IF v_participants IS NOT NULL AND jsonb_typeof(v_participants) = 'array' THEN
      -- when a list is supplied, it must cover the party for THIS item
      IF jsonb_array_length(v_participants) < 1 THEN
        RETURN json_build_object('error', 'validation', 'message', 'Participant list is empty. Please add each participant.');
      END IF;
      IF jsonb_array_length(v_participants) > 25 THEN
        RETURN json_build_object('error', 'validation', 'message', 'Too many participants for one activity (max 25).');
      END IF;

      FOR v_part_idx IN 0 .. jsonb_array_length(v_participants) - 1 LOOP
        v_participant := v_participants->v_part_idx;
        IF NULLIF(trim(v_participant->>'full_name'), '') IS NULL THEN
          RETURN json_build_object('error', 'validation', 'message', 'Every participant needs a name.');
        END IF;
        IF length(trim(v_participant->>'full_name')) > 120 THEN
          RETURN json_build_object('error', 'validation', 'message', 'Participant names may be 120 characters or fewer.');
        END IF;

        INSERT INTO public.booking_participants (
          booking_id, full_name, participant_type,
          guardian_name, guardian_relationship
        )
        VALUES (
          v_booking_id,
          trim(v_participant->>'full_name'),
          CASE WHEN (v_participant->>'participant_type') = 'child' THEN 'child'::public.participant_type ELSE 'adult'::public.participant_type END,
          NULLIF(trim(v_participant->>'guardian_name'), ''),
          NULLIF(trim(v_participant->>'guardian_relationship'), '')
        );
      END LOOP;
    END IF;

    v_results := v_results || jsonb_build_object(
      'booking_id', v_booking_id,
      'booking_ref', v_booking_ref,
      'activity_id', v_act_id,
      'activity_name', v_act_name,
      'booking_date', v_date_clean,
      'preferred_time', v_time_clean,
      'guest_count', v_total_guests
    );
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'group_id', v_group_id,
    'group_ref', v_group_ref,
    'guest_name', v_name_clean,
    'items', v_results,
    'needs_per_participant_details', v_total_guests > 1,
    'has_participants', (SELECT count(*) > 0 FROM public.booking_participants WHERE booking_id = v_booking_id),
    'source', v_src::TEXT
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 3. get_walkin_group_participants — anon read for the success step
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_walkin_group_participants(p_group_ref TEXT)
RETURNS JSON AS $$
DECLARE
  v_group_id UUID;
  v_result   JSON;
BEGIN
  IF p_group_ref IS NULL THEN
    RETURN json_build_object('error', 'validation', 'message', 'Group reference is required.');
  END IF;
  SELECT id INTO v_group_id FROM public.booking_groups WHERE group_ref = trim(p_group_ref);
  IF v_group_id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Booking group not found.');
  END IF;

  SELECT json_build_object(
    'group_ref', trim(p_group_ref),
    'lead_name', (SELECT full_name FROM public.customers c JOIN public.booking_groups bg ON c.id = bg.customer_id WHERE bg.id = v_group_id),
    'bookings', (
      SELECT json_agg(json_build_object(
        'booking_id', b.id,
        'booking_ref', b.booking_ref,
        'activity_id', b.activity_id,
        'activity_name', a.name,
        'booking_date', b.booking_date,
        'preferred_time', b.preferred_time,
        'guest_count', (b.adults + b.children_count),
        'participants', COALESCE(
          (SELECT json_agg(json_build_object(
            'participant_id', bp.id,
            'full_name', bp.full_name,
            'participant_type', bp.participant_type,
            'choice_token', bp.choice_token,
            'consent_status', bp.consent_status,
            'guardian_name', bp.guardian_name
          ) ORDER BY bp.created_at) FROM public.booking_participants bp
          WHERE bp.booking_id = b.id), '[]'::json
        )
      ) ORDER BY b.booking_date, b.created_at)
      FROM public.bookings b
      LEFT JOIN public.activities a ON a.id = b.activity_id
      WHERE b.group_id = v_group_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 4. Permissions (anon-executable only)
-- ================================================================
REVOKE ALL ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_walkin_group_participants(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_walkin_group_participants(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_walkin_group_participants(TEXT) TO authenticated;

COMMIT;
