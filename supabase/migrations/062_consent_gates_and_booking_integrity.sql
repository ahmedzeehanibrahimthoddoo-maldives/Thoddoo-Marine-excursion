-- ================================================================
-- 062 — HARD CONSENT & LIABILITY GATES + BOOKING INTEGRITY
-- ================================================================
-- Rules (as decided with the owner, 2026-09-27):
--   1. NO booking enters the system without an explicit agreement to
--      the Consent & Liability terms (bookings.guest_agreed = true).
--      Every creation path (online, walk-in, WhatsApp AND staff admin)
--      must record that agreement. Enforced with a BEFORE INSERT trigger
--      so no future code path can silently bypass it.
--   2. The one RPC that accepted agreement but never enforced it —
--      submit_public_booking_group_v2 (migration 060) — is recreated to
--      validate p_guest_agreed and persist guest_agreed/agreement_version.
--   3. A booking with per-participant rows (1+ adults) cannot be
--      CONFIRMED until EVERY participant s consent is signed
--      (consent_status = 'signed' for all booking_participants).
--   4. Cancelling a booking automatically VOIDS all linked consent &
--      liability forms (status -> 'voided', reason + timestamp recorded).
--      Records are kept for audit — nothing is deleted.
-- ================================================================

BEGIN;

-- ================================================================
-- 1. HARD CREATION GATE — bookings require guest agreement
-- ================================================================
CREATE OR REPLACE FUNCTION public.enforce_booking_agreement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.guest_agreed IS NOT TRUE THEN
    RAISE EXCEPTION 'Booking cannot be created without the guest agreeing to the Consent & Liability terms (guest_agreed must be true).';
  END IF;
  NEW.guest_agreed_at := COALESCE(NEW.guest_agreed_at, now());
  NEW.agreement_version := COALESCE(NEW.agreement_version, 'booking-enquiry-v1');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_require_agreement ON public.bookings;
CREATE TRIGGER trg_bookings_require_agreement
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_agreement();

-- ================================================================
-- 2. REBUILD submit_public_booking_group_v2 (fixes migration 060 gap)
--    - validates p_guest_agreed IS TRUE up front
--    - persists guest_agreed, guest_agreed_at, agreement_version
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
  -- ---------- consent & liability gate ----------
  IF p_guest_agreed IS NOT TRUE THEN
    RETURN json_build_object('error', 'validation', 'message', 'You must agree to the consent and liability terms before a booking can be submitted.');
  END IF;

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
-- 3. CONFIRMATION GATE — per-participant bookings need everyone signed
-- ================================================================
CREATE OR REPLACE FUNCTION public.enforce_booking_confirm_consent()
RETURNS TRIGGER AS $$
DECLARE
  v_unsigned INT;
  v_ref      TEXT;
BEGIN
  -- Only applies on the transition TO 'confirmed'. Completion/cancel/no_show
  -- are unaffected. Admin direct updates are covered too (server-side).
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    -- If the booking has participant rows, EVERY participant must be signed.
    SELECT count(*) INTO v_unsigned
    FROM public.booking_participants bp
    WHERE bp.booking_id = NEW.id
      AND bp.consent_status <> 'signed';

    IF v_unsigned > 0 THEN
      v_ref := COALESCE(NEW.booking_ref, NEW.id::TEXT);
      RAISE EXCEPTION 'Booking % has % unsigned participant(s). Every participant must sign the consent & liability form before confirmation.', v_ref, v_unsigned;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_confirm_requires_consent ON public.bookings;
CREATE TRIGGER trg_bookings_confirm_requires_consent
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_confirm_consent();

-- ================================================================
-- 4. CANCEL -> VOID ALL CONSENT & LIABILITY (records kept)
-- ================================================================
CREATE OR REPLACE FUNCTION public.void_consent_on_booking_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.consent_forms
    SET status = 'voided',
        void_reason = COALESCE(NULLIF(trim(void_reason), ''), 'Booking cancelled'),
        voided_at = now(),
        voided_by = COALESCE(voided_by, public.current_staff_id())
    WHERE booking_id = NEW.id
      AND status IN ('pending', 'signed');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_cancel_voids_consents ON public.bookings;
CREATE TRIGGER trg_bookings_cancel_voids_consents
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.void_consent_on_booking_cancel();

-- ================================================================
-- 5. Permissions (unchanged signatures — re-affirm grants)
-- ================================================================
REVOKE ALL ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_public_booking_group_v2(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

COMMIT;