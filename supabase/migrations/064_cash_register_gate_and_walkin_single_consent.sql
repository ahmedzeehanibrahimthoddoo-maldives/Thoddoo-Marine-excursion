-- ================================================================
-- 064 — CASH-REGISTER-OPEN GATE + UNIFIED WALK-IN SINGLE CONSENT
-- ================================================================
-- Owner rules (decided 2026-09-28):
--   1. The cash register must be OPEN before any booking is added or
--      confirmed from the system. Website (online source) submissions may
--      still land at any time as 'pending' — those are guest requests, only
--      confirmed once staff open the register.
--   2. The walk-in wizard (staff QR link) submits EVERY activity request —
--      single OR multi-activity — through submit_public_booking_group_v2 so
--      each participant gets a real-name row, a server choice_token and must
--      personally sign the consent & liability waiver. Single-activity
--      walk-ins now flow exactly like groups (migration 060/061) instead of
--      the old booking-level submit_public_consent path.
--
-- Adds:
--   a) public.is_cash_register_open()            — SECURITY DEFINER helper,
--                                                  true when an 'open'
--                                                  register exists for UTC today.
--   b) BEFORE INSERT trigger (source = 'walk_in') — no walk-in request rows
--                                                  while register is closed.
--   c) enforce_booking_confirm_consent() rebuilt — ANY transition to
--      'confirmed' requires an open register; the existing group-only
--      per-participant signed gate (063) is preserved.
--   d) submit_public_booking_group_v2 rebuilt     — friendly JSON error when a
--      walk_in submission arrives while the register is closed.
-- ================================================================

BEGIN;

-- ================================================================
-- a) REGISTER-OPEN HELPER (UTC business day, matches register_date default)
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_cash_register_open()
RETURNS BOOLEAN AS $$
DECLARE
  v_open BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.cash_registers
    WHERE register_date = (now() AT TIME ZONE 'UTC')::DATE
      AND status = 'open'
  ) INTO v_open;
  RETURN v_open;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- b) CREATION GATE — no walk-in request rows while register is closed
-- ================================================================
-- Covers every insert path: the group_v2 RPC AND direct staff inserts
-- (admin createBooking). Online website submissions are unaffected.
CREATE OR REPLACE FUNCTION public.enforce_walkin_register_open_on_create()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source = 'walk_in' AND NOT public.is_cash_register_open() THEN
    RAISE EXCEPTION 'The cash register is not open yet. Please ask a member of staff to open the register for today before adding walk-in booking requests.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_bookings_walkin_require_open_register ON public.bookings;
CREATE TRIGGER trg_bookings_walkin_require_open_register
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_walkin_register_open_on_create();

-- ================================================================
-- c) CONFIRMATION GATE — open register required for ANY confirmation
-- ================================================================
-- Rebuilt on top of 063: still blocks group bookings until every
-- participant signed, and now also blocks ANY booking (all sources)
-- from reaching 'confirmed' while the register is closed.
CREATE OR REPLACE FUNCTION public.enforce_booking_confirm_consent()
RETURNS TRIGGER AS $$
DECLARE
  v_unsigned INT;
  v_ref      TEXT;
BEGIN
  -- Only applies on the transition TO 'confirmed'. Completion/cancel/no_show
  -- are unaffected. Admin direct updates are covered too (server-side).
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    -- Business rule: no confirmation while the desk register is closed.
    IF NOT public.is_cash_register_open() THEN
      RAISE EXCEPTION 'The cash register is not open yet. Please open the register for today before confirming this booking.';
    END IF;

    -- Only group bookings require every participant to sign. Single-activity
    -- bookings are gated on the per-participant consent signed at submit time.
    IF NEW.group_id IS NOT NULL THEN
      SELECT count(*) INTO v_unsigned
      FROM public.booking_participants bp
      WHERE bp.booking_id = NEW.id
        AND bp.consent_status <> 'signed';

      IF v_unsigned > 0 THEN
        v_ref := COALESCE(NEW.booking_ref, NEW.id::TEXT);
        RAISE EXCEPTION 'Booking % has % unsigned participant(s). Every participant must sign the consent & liability form before confirmation.', v_ref, v_unsigned;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- d) REBUILD submit_public_booking_group_v2 — friendly register gate
-- ================================================================
-- Identical to 062 except that a walk_in submission returns a JSON error
-- early when the register is closed (so the wizard can show the copy
-- instead of a raw trigger exception).
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
  -- ---------- consent & liability gate ----------
  IF p_guest_agreed IS NOT TRUE THEN
    RETURN json_build_object('error', 'validation', 'message', 'You must agree to the consent and liability terms before a booking can be submitted.');
  END IF;

  -- ---------- source ----------
  v_src := COALESCE(NULLIF(trim(p_source), ''), 'online')::booking_source;
  IF v_src NOT IN ('online', 'walk_in', 'whatsapp') THEN
    RETURN json_build_object('error', 'validation', 'message', 'Invalid booking source.');
  END IF;

  -- ---------- cash-register gate (staff walk-in wizard only) ----------
  IF v_src = 'walk_in' AND NOT public.is_cash_register_open() THEN
    RETURN json_build_object('error', 'register_closed', 'message', 'The cash register is not open yet. Please ask a member of staff to open the register for today before submitting this booking.');
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

    v_item_key := gen_random_uuid();

    INSERT INTO public.bookings (
      customer_id, activity_id, source, status, guests,
      adults, children_count,
      booking_date, preferred_time, hotel_name, room_number,
      pickup_location, total_cents, booking_ref, group_id,
      guest_agreed, guest_agreed_at, agreement_version,
      created_at, updated_at, booking_currency
    )
    SELECT v_customer_id, v_act_id, v_src, 'pending', v_total_guests,
      (v_total_guests - COALESCE(p_children,0)), COALESCE(p_children,0),
      to_date(v_date_clean, 'YYYY-MM-DD')::DATE,
      v_time_clean,
      v_hotel_clean, v_room_clean, NULLIF(trim(p_pickup_location), ''),
      COALESCE(v_act_base, 0), 'W' || upper(substr(md5(random()::text), 1, 7)), v_group_id,
      true, now(), 'booking-enquiry-v1',
      now(), now(), v_act_currency
    RETURNING id, booking_ref INTO v_booking_id, v_booking_ref;

    -- ---------- per-participant rows (only if a list was supplied) ----------
    v_participants := v_item->'participants';
    IF v_participants IS NOT NULL AND jsonb_typeof(v_participants) = 'array' THEN
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
-- e) Permissions (unchanged signature — re-affirm grants)
-- ================================================================
REVOKE ALL ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

COMMIT;