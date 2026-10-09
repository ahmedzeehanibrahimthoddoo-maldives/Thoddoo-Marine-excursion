-- =============================================
-- Migration 079: AGENT QR TOKEN FIX + PARTY-SIZED PRICING
-- =============================================
-- Two live bugs, both found by inspecting production rather than by a report
-- of an exception:
--
-- BUG 1 - AGENT QR LINKS COULD NEVER BE ISSUED (0 rows ever created)
--   agent_booking_links.token defaults to
--     encode(public._gen_random_bytes(32), 'hex')
--   and migrations 012-015 revoked EXECUTE on public._gen_random_bytes from
--   PUBLIC, anon AND authenticated. A column DEFAULT is evaluated as the
--   inserting user, so every staff INSERT into agent_booking_links died with
--   "permission denied for function _gen_random_bytes" - the modal showed an
--   error and no QR was ever stored, which is why /agent/<token> could never
--   be opened. Fixed by giving the column a SECURITY DEFINER generator, which
--   keeps _gen_random_bytes locked down for everyone else.
--
-- BUG 2 - A PARTY WAS CHARGED ONE PERSON'S PRICE
--   submit_public_booking_group_v2 wrote total_cents = base_price_cents
--   regardless of party size, and ignored the chosen pricing option entirely.
--   2 pax on the $45 dolphin cruise was stored as $45, not $90. activities
--   that DO have pricing rows are unaffected (jet ski, kayak, water skiing,
--   wakeboarding, banana ride, funtube) because the row decides the unit.
--
-- =============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Agent QR: a token generator staff are actually allowed to call
-- ---------------------------------------------------------------
-- SECURITY DEFINER so it runs as the owner (postgres) and can call the
-- revoked helper. Returns the same 64-char hex shape the consent/rental
-- signing tokens use, so nothing downstream has to change.
CREATE OR REPLACE FUNCTION public.gen_agent_link_token()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(public._gen_random_bytes(32), 'hex');
$$;

REVOKE ALL ON FUNCTION public.gen_agent_link_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gen_agent_link_token() FROM anon;
GRANT EXECUTE ON FUNCTION public.gen_agent_link_token() TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.agent_booking_links') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.agent_booking_links
             ALTER COLUMN token SET DEFAULT public.gen_agent_link_token()';
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 2. Public / walk-in booking totals that respect the party size
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_public_booking_group_v2(
  p_items               JSONB,
  p_guest_name          TEXT,
  p_guest_phone         TEXT,
  p_guest_email         TEXT,
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
  v_email_clean    TEXT;
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
  v_opt_label      TEXT;
  v_opt_price      INT;
  v_opt_unit       TEXT;
  v_note           TEXT;
  v_has_pricing    BOOLEAN;
  v_date_clean     TEXT;
  v_time_clean     TEXT;
  v_item_key       UUID;
  v_booking_id     UUID;
  v_booking_ref    TEXT;
  v_participant    JSONB;
  v_participants   JSONB;
  v_parts          JSONB := '[]'::jsonb;
  v_part_idx       INT;
  v_part_count     INT;
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

  -- 072 made a valid email a precondition for creating ANY booking, because the
  -- guest copies (invoice, consent, receipts) are only deliverable by email.
  -- The public forms had no field to collect one, so every website and walk-in
  -- submission was rejected by require_customer_email_before_booking. The email
  -- is now collected and stored here, validated with 072's own is_valid_email.
  v_email_clean := lower(NULLIF(trim(p_guest_email), ''));
  IF NOT public.is_valid_email(v_email_clean) THEN
    RETURN json_build_object('error', 'validation', 'message', 'A valid email address is required so we can send your invoice and safety waiver.');
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
    INSERT INTO public.customers (full_name, phone, email)
    VALUES (v_name_clean, v_phone_clean, v_email_clean)
    RETURNING id INTO v_customer_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.customers
     WHERE id = v_customer_id AND public.is_valid_email(email)
  ) THEN
    UPDATE public.customers SET email = v_email_clean WHERE id = v_customer_id;
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

    SELECT base_price_cents, currency, price_note INTO v_act_base, v_act_currency, v_note
    FROM public.activities WHERE id = v_act_id;

    -- ---------- price resolution (079) ----------
    -- Before 079 the booking TOTAL was written as activities.base_price_cents,
    -- so a party of 4 on the $45 dolphin cruise was recorded as $45 instead of
    -- $180 and the client showed the same flat figure. Three tiers, cheapest
    -- source of truth first:
    --   1. a guest-supplied option label is only honoured when it matches a
    --      real activity_pricing row for THIS activity; that row carries its
    --      own pricing_unit, so the unit is never guessed.
    --   2. an activity with priced options but no usable label is charged its
    --      flat base price once (a jet ski session is per ride, not per head).
    --   3. an activity with no pricing rows is an "adventure": the unit comes
    --      from activities.price_note, which reception already types per trip
    --      ('/ person', '/ hour', '/ boat (half day)'). 007 documented this
    --      per_person fallback but the RPC never implemented it.
    v_opt_label := NULLIF(trim(COALESCE(v_item->>'pricing_option_label', '')), '');
    v_opt_price := NULL;
    v_opt_unit  := NULL;

    IF v_opt_label IS NOT NULL THEN
      SELECT price_cents, pricing_unit INTO v_opt_price, v_opt_unit
      FROM public.activity_pricing
      WHERE activity_id = v_act_id AND label = v_opt_label
      LIMIT 1;
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.activity_pricing WHERE activity_id = v_act_id)
      INTO v_has_pricing;

    IF v_opt_price IS NOT NULL THEN
      v_act_base  := v_opt_price;
      v_opt_unit  := COALESCE(v_opt_unit, 'per_person');
    ELSE
      v_opt_unit  := CASE
                       WHEN v_has_pricing THEN 'per_unit'
                       WHEN v_note IS NOT NULL AND lower(v_note) LIKE '%person%' THEN 'per_person'
                       ELSE 'per_unit'
                     END;
    END IF;

    IF v_opt_unit = 'per_person' THEN
      v_act_base := COALESCE(v_act_base, 0) * v_total_guests;
    ELSE
      v_act_base := COALESCE(v_act_base, 0);
    END IF;

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

    -- ---------- HARD GATE (066): every item must carry every participant ----------
    -- No booking may be created unless the caller supplies a full per-participant
    -- list (lead guest at minimum). This closes the legacy loophole where a
    -- booking entered the system with no participant names and no consent path.
    v_participants := v_item->'participants';
    IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Every guest must be listed as a participant with their full name before this booking can be submitted.');
    END IF;

    v_part_count := jsonb_array_length(v_participants);
    IF v_part_count < 1 THEN
      RETURN json_build_object('error', 'validation', 'message', 'Participant list is empty. Please add each participant.');
    END IF;
    IF v_part_count > 25 THEN
      RETURN json_build_object('error', 'validation', 'message', 'Too many participants for one activity (max 25).');
    END IF;

    FOR v_part_idx IN 0 .. v_part_count - 1 LOOP
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

REVOKE ALL ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;


COMMENT ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) IS
  'Public/walk-in group booking. p_guest_email is required (072). total_cents is 079 party-sized: pricing_option_label -> activity_pricing row (price + unit), else base_price x guests when activities.price_note says per person, else flat base price.';

COMMIT;
