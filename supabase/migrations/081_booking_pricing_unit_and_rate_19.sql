-- 081_booking_pricing_unit_and_rate_19.sql
--
-- Two gaps in how a booking's money is recorded:
--
-- 1. There was nowhere on a booking to record that its price was per person.
--    activity_pricing.pricing_unit holds the rule, but that is the activity's
--    live setting: if the price list changes, a reopened booking could no
--    longer show how its own total had been derived. This snapshots the unit
--    on the booking, exactly the way commission_mode/commission_percent
--    snapshot the commission rule, and reuses the already-present
--    bookings.pricing_option_cents column to hold the unit price.
--
-- 2. The MVR/USD rate was 18. It is 19, so new bookings snapshot 19. Existing
--    rows keep the rate they were created with — that column is a per-booking
--    snapshot by design, and rewriting it would silently restate revenue that
--    has already been reported. The column default alone is not enough: the
--    booking RPCs pass their own hardcoded rate, so part 3 corrects those.

begin;

-- =============================================
-- 1. Per-person / per-unit basis on the booking
-- =============================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pricing_unit TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_pricing_unit_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_pricing_unit_check
      CHECK (pricing_unit IS NULL OR pricing_unit IN ('per_person', 'per_unit', 'per_hour'));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.pricing_unit IS
  'How total_cents was derived from pricing_option_cents: per_person | per_unit | per_hour. Snapshot of the pricing basis, not a live price-list setting.';

-- The unit price the booking was sold at (per person when pricing_unit is
-- 'per_person'). Total = pricing_option_cents x guests for per_person.
ALTER TABLE public.bookings
  ALTER COLUMN pricing_option_cents SET DEFAULT 0;

-- =============================================
-- 2. MVR/USD is 19
-- =============================================
ALTER TABLE public.bookings
  ALTER COLUMN exchange_rate_mvr_per_usd SET DEFAULT 19;

-- =============================================
-- 3. The live booking RPCs must snapshot 19 too
-- =============================================
-- Both of these are the *current* definitions: submit_public_booking_group_v2
-- was last redefined in 079 and is what the walk-in form and the public booking
-- wizard both call, and auto_partner_split_bookings was last redefined in 077
-- and fires on every booking insert and update. Each carried a hardcoded
-- v_exchange_rate := 18, so a booking created through the walk-in or QR flow
-- snapshotted 18 while the admin form used 19 -- which made its MVR equivalent
-- 5% light in every report that converts by booking_rate_snapshot. The bodies
-- are copied verbatim from 079 and 077 with only that literal changed;
-- redefinition keeps the existing signature and grants.

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
  v_exchange_rate  NUMERIC(10,4) := 19;
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

CREATE OR REPLACE FUNCTION public.auto_partner_split_bookings()
RETURNS TRIGGER AS $$
DECLARE
  v_pax      INTEGER;
  v_comm     INTEGER;
  v_net      INTEGER;
  v_partner  TEXT;
  v_mode     TEXT;
  v_pct      NUMERIC;
  v_basis    INTEGER;
  v_currency TEXT;
  v_act_ccy  TEXT;
  v_rate     NUMERIC;
BEGIN
  IF NEW.activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.commission_cents, a.net_cents, a.partner, a.commission_mode, a.commission_percent,
         a.currency
    INTO v_comm, v_net, v_partner, v_mode, v_pct, v_act_ccy
    FROM public.activities a
   WHERE a.id = NEW.activity_id;

  IF v_comm IS NULL OR v_net IS NULL THEN
    RETURN NEW;
  END IF;

  -- Partner name (only when not explicitly provided).
  IF NEW.partner IS NULL AND v_partner IS NOT NULL THEN
    NEW.partner := v_partner;
  END IF;

  v_pax := GREATEST(COALESCE(NEW.guests, 0), 0);
  IF v_pax = 0 THEN
    v_pax := GREATEST(COALESCE(NEW.adults, 0), 0)
           + GREATEST(COALESCE(NEW.children_count, 0), 0);
  END IF;

  -- What a percentage is taken of: the sale, not the pax count.
  v_basis := GREATEST(COALESCE(NEW.total_cents, 0), COALESCE(NEW.estimated_total_cents, 0));

  -- Commission is always recorded in the booking's own currency, converted with
  -- the rate the booking snapshotted (008), so reports can sum by
  -- booking_currency without knowing which currency the rate was quoted in.
  v_currency := COALESCE(NEW.booking_currency, 'USD');
  v_act_ccy := COALESCE(v_act_ccy, 'USD');
  v_rate := COALESCE(NEW.exchange_rate_mvr_per_usd, 19);

  -- Snapshot the rule, but only when the caller did not state one.
  IF NEW.commission_mode IS NULL THEN
    NEW.commission_mode := COALESCE(v_mode, 'fixed');
  END IF;
  IF NEW.commission_percent IS NULL THEN
    NEW.commission_percent := v_pct;
  END IF;
  IF NEW.commission_currency IS NULL THEN
    NEW.commission_currency := v_currency;
  END IF;

  IF NEW.commission_mode = 'percent' AND COALESCE(v_pct, 0) > 0 THEN
    IF v_basis > 0 AND (NEW.commission_cents IS NULL OR NEW.commission_cents = 0) THEN
      NEW.commission_cents := ROUND(v_basis * v_pct / 100.0);
    END IF;
    -- Operator's take is the sale minus the partner's cut. Only overwrite a net
    -- that still equals the sale, i.e. one nobody set by hand.
    IF NEW.net_cents IS NULL OR NEW.net_cents = 0 OR NEW.net_cents = v_basis THEN
      NEW.net_cents := GREATEST(v_basis - NEW.commission_cents, 0);
    END IF;
  ELSIF v_comm > 0 OR v_net > 0 THEN
    -- Fixed amount, per guest (the 054/056 behaviour).
    IF v_pax > 0 THEN
      IF NEW.commission_cents IS NULL OR NEW.commission_cents = 0 THEN
        NEW.commission_cents := CASE
          WHEN v_act_ccy = v_currency THEN v_comm * v_pax
          WHEN v_act_ccy = 'MVR'   THEN ROUND((v_comm * v_pax) / v_rate)
          ELSE ROUND((v_comm * v_pax) * v_rate)
        END;
      END IF;
      IF NEW.net_cents IS NULL OR NEW.net_cents = 0 THEN
        NEW.net_cents := CASE
          WHEN v_act_ccy = v_currency THEN v_net * v_pax
          WHEN v_act_ccy = 'MVR'   THEN ROUND((v_net * v_pax) / v_rate)
          ELSE ROUND((v_net * v_pax) * v_rate)
        END;
      END IF;
    END IF;
  ELSE
    -- No partner split: keep the full guest amount.
    IF (NEW.commission_cents IS NULL OR NEW.commission_cents = 0)
       AND (NEW.net_cents IS NULL OR NEW.net_cents = 0) THEN
      NEW.net_cents := v_basis;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

commit;
