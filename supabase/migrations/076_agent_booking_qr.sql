-- =============================================
-- Migration 076: AGENT BOOKING QR (rate never shown to the guest)
-- =============================================
-- Staff hand a guest a QR code. The guest opens it, fills the booking form,
-- signs the activity consent + liability waiver per participant, and the
-- booking lands in the PMS attributed to that agent.
--
-- WHY A NEW SOURCE + LINK TABLE INSTEAD OF REUSING THE WALK-IN QR:
-- The walk-in page (/walkin/[slug]) deliberately renders prices. This flow is
-- for agent-sold trips where the rate is quoted face-to-face, so the guest page
-- must contain ZERO price data — not hidden with CSS, but absent from the HTML,
-- the RSC payload and every network response. That guarantee is only
-- enforceable if the guest-facing read path never selects a price column, which
-- is why this gets its own RPC pair instead of a query flag on the walk-in one.
--
-- WHAT IS ADDED
--   1. booking_source gains 'agent'.
--   2. agent_booking_links — one row per issued QR. Holds the token, the issuing
--      agent (staff_profiles id + a free-text snapshot of their name so the
--      attribution survives a staff rename/deactivation), the pre-selected
--      trips, and a 7-day expiry (matches the consent/rental token convention;
--      a QR pasted on a handout should go dead rather than stay a permanently
--      open public booking form).
--   3. bookings.agent_id / agent_name + booking_groups.agent_id / agent_name.
--      Denormalised onto the group so one lookup shows who sold the booking.
--   4. submit_agent_booking(...) — anon-callable, mirrors
--      submit_public_booking_group_v2 (060) but resolves prices SERVER-SIDE and
--      never returns them. Validates the token, enforces expiry, and requires
--      the guest's chosen activity_ids to be a subset of the link's allowed
--      trips so a guest cannot smuggle in an unquoted activity by editing the
--      request.
--   5. get_agent_booking_link(p_token) — anon read of the link. Returns ONLY
--      activity id/name/category and the agent name. Deliberately does not
--      select base_price_cents, activity_pricing, or total_cents.
--
-- CONSENT / LIABILITY: unchanged. submit_agent_booking writes booking_participants
-- rows exactly like 060, so each participant carries a server-generated
-- choice_token and signs through the EXISTING submit_walkin_participant_consent
-- RPC (061). The waiver gate therefore cannot be bypassed by this flow.
--
-- CASH REGISTER (064): 'agent' is NOT gated on an open register at creation time,
-- deliberately. An agent sells a trip in advance, so this is a guest request like
-- an online enquiry — it lands 'pending' and staff confirm it in the system,
-- where enforce_booking_confirm_consent still requires the register to be open.
-- =============================================

BEGIN;

-- ------------------------------------------------------------
-- 1. New booking source
-- ------------------------------------------------------------
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- Postgres, so this one statement is committed on its own.
COMMIT;

ALTER TYPE public.booking_source ADD VALUE IF NOT EXISTS 'agent';

BEGIN;

-- ------------------------------------------------------------
-- 2. Agent booking links
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_booking_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 64 hex chars, same shape as the consent/rental signing tokens.
  token TEXT NOT NULL UNIQUE DEFAULT encode(public._gen_random_bytes(32), 'hex'),
  -- Which staff member issued the QR. SET NULL so deactivating an account never
  -- deletes the sales record; agent_name below is the durable snapshot.
  agent_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  -- Free-text name, because agents may sell under a name that is not exactly
  -- their staff_profiles.full_name (and reception may type an on-duty name).
  agent_name TEXT NOT NULL,
  -- Trips this link is allowed to book. Empty = any active trip.
  activity_ids UUID[] NOT NULL DEFAULT '{}',
  -- Which pricing option the agent quoted, chosen in the admin BEFORE issuing
  -- the QR. Deliberately NOT taken from the guest request: the guest never sees
  -- prices, so they cannot be trusted to pick a priced option, and letting them
  -- send a label would let a hand-crafted request choose the ledger total.
  quoted_option_labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Plain now() + interval on a TIMESTAMPTZ, the same shape as the check-in /
  -- consent token expiries (010). The Maldives-local variant would land a naive
  -- timestamp whose meaning depends on the session TimeZone; the admin action
  -- writes this explicitly anyway, so the default is only a fallback.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  -- Bookings created from this link, for the "how many did this QR sell?" count.
  uses_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_links_active ON public.agent_booking_links (active);
CREATE INDEX IF NOT EXISTS idx_agent_links_expires ON public.agent_booking_links (expires_at);

ALTER TABLE public.agent_booking_links ENABLE ROW LEVEL SECURITY;

-- Staff read everything; the anon path goes through SECURITY DEFINER RPCs only.
DROP POLICY IF EXISTS agent_links_staff_select ON public.agent_booking_links;
CREATE POLICY agent_links_staff_select ON public.agent_booking_links
  FOR SELECT TO authenticated
  USING (public.current_staff_role() IS NOT NULL);

-- Staff may issue and revoke links from the admin app.
DROP POLICY IF EXISTS agent_links_staff_write ON public.agent_booking_links;
CREATE POLICY agent_links_staff_write ON public.agent_booking_links
  FOR ALL TO authenticated
  USING (public.current_staff_role() IS NOT NULL)
  WITH CHECK (public.current_staff_role() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON public.agent_booking_links TO authenticated;
REVOKE ALL ON public.agent_booking_links FROM anon;

-- ------------------------------------------------------------
-- 3. Agent attribution on bookings + groups
-- ------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

ALTER TABLE public.booking_groups
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_agent ON public.bookings (agent_id);

-- ------------------------------------------------------------
-- 4. get_agent_booking_link — the guest-facing read
-- ------------------------------------------------------------
-- NO price column is selected here. This is the only read path the guest page
-- uses, so this function is the enforcement point for "the guest never sees the
-- rate". Adding base_price_cents to the SELECT below would break that promise.
CREATE OR REPLACE FUNCTION public.get_agent_booking_link(p_token TEXT)
RETURNS JSON AS $$
DECLARE
  v_link public.agent_booking_links%ROWTYPE;
  v_result JSON;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'This booking link is not valid.');
  END IF;

  SELECT * INTO v_link
  FROM public.agent_booking_links
  WHERE token = trim(p_token);

  IF v_link.id IS NULL THEN
    RETURN json_build_object('error', 'not_found', 'message', 'This booking link is not valid.');
  END IF;

  IF NOT v_link.active THEN
    RETURN json_build_object('error', 'inactive', 'message', 'This booking link has been closed. Please ask your agent for a new QR code.');
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'This booking link has expired. Please ask your agent for a new QR code.');
  END IF;

  SELECT json_build_object(
    'agent_name', v_link.agent_name,
    'expires_at', v_link.expires_at,
    'activities', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', a.id,
        'name', a.name,
        'category', a.category,
        'location', a.location,
        'duration_minutes', a.duration_minutes,
        'image', a.image
      ) ORDER BY a.name), '[]'::json)
      FROM public.activities a
      WHERE a.active = true
        AND (cardinality(v_link.activity_ids) = 0 OR a.id = ANY(v_link.activity_ids))
    )
  ) INTO v_result;
  -- quoted_option_labels is intentionally absent from this payload: even an
  -- option LABEL can encode a tier ("Premium", "2-dive package") and the guest
  -- must not be able to infer the quoted rate from it.

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_agent_booking_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_booking_link(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_agent_booking_link(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. submit_agent_booking — create the group, prices stay server-side
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_agent_booking(
  p_token                  TEXT,
  p_items                  JSONB,
  p_guest_name             TEXT,
  p_guest_phone            TEXT,
  p_adults                 INT,
  p_children               INT,
  p_hotel_name             TEXT,
  p_room_number            TEXT,
  p_pickup_location        TEXT,
  p_special_requests       TEXT,
  p_guest_agreed           BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_link          public.agent_booking_links%ROWTYPE;
  v_customer_id   UUID;
  v_group_id      UUID;
  v_group_ref     TEXT;
  v_items         JSONB;
  v_item          JSONB;
  v_result        JSONB := '[]'::jsonb;
  v_participants  JSONB;
  v_participant   JSONB;
  v_part_idx      INT;
  v_act_id        UUID;
  v_act_name      TEXT;
  v_act_currency  TEXT;
  v_date_clean    TEXT;
  v_time_clean    TEXT;
  v_name_clean    TEXT;
  v_phone_clean   TEXT;
v_hotel_clean   TEXT;
  v_room_clean    TEXT;
  v_pickup_clean  TEXT;
  v_special_clean TEXT;
  v_total_guests  INT;
  -- Server-side only. Computed from the price tables and written to
  -- bookings.total_cents for the staff ledger; never returned to the caller.
  -- v_item_cents is this trip's own cost; v_total_cents accumulates the party
  -- total across the group and is never written to a booking.
  v_total_cents   INT := 0;
  v_item_cents    INT := 0;
  v_unit_cents    INT := 0;
  v_opt_label     TEXT;
  v_opt_unit      TEXT;
  v_link_id       UUID;
  v_booking_id    UUID;
  v_booking_ref   TEXT;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'This booking link is not valid.');
  END IF;

  SELECT * INTO v_link
  FROM public.agent_booking_links
  WHERE token = trim(p_token);

  IF v_link.id IS NULL OR NOT v_link.active THEN
    RETURN json_build_object('error', 'not_found', 'message', 'This booking link is not valid.');
  END IF;
  IF v_link.expires_at <= now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'This booking link has expired. Please ask your agent for a new QR code.');
  END IF;
  v_link_id := v_link.id;

  IF NOT COALESCE(p_guest_agreed, false) THEN
    RETURN json_build_object('error', 'validation', 'message', 'Please confirm you accept the terms to continue.');
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

  v_total_guests := COALESCE(p_adults, 0) + COALESCE(p_children, 0);
  IF v_total_guests < 1 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Please add at least one guest.');
  END IF;
  IF v_total_guests > 50 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Maximum 50 total guests per party.');
  END IF;

  v_hotel_clean  := NULLIF(trim(COALESCE(p_hotel_name, '')), '');
  v_room_clean   := NULLIF(trim(COALESCE(p_room_number, '')), '');
  v_pickup_clean := NULLIF(trim(COALESCE(p_pickup_location, '')), '');
  v_special_clean := NULLIF(trim(COALESCE(p_special_requests, '')), '');

  -- ---------- validate EVERY item BEFORE writing anything ----------
  -- plpgsql does not roll back on RETURN, so a mid-loop validation error would
  -- leave the customer, the group and any earlier bookings committed while the
  -- guest is shown an error and retries. One up-front pass means this function
  -- either writes the whole group or writes nothing.
  v_items := p_items;
  FOR v_idx IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->v_idx;
    v_act_id := (v_item->>'activity_id')::UUID;
    IF v_act_id IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'One of the selected activities could not be read. Please refresh.');
    END IF;

    SELECT name INTO v_act_name
    FROM public.activities
    WHERE id = v_act_id AND active = true;

    IF v_act_name IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'One of the selected activities is no longer available. Please refresh.');
    END IF;

    -- The link may be scoped to specific trips. A guest who edits the request to
    -- add an unquoted activity must not get it booked at the agent's rate.
    IF cardinality(v_link.activity_ids) > 0 AND NOT (v_act_id = ANY(v_link.activity_ids)) THEN
      RETURN json_build_object('error', 'validation', 'message', 'That activity is not part of this booking. Please ask your agent.');
    END IF;

    v_date_clean := NULLIF(trim(COALESCE(v_item->>'booking_date', '')), '');
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

    -- The consent gate depends on this list, so an unusable one has to fail here.
    v_participants := v_item->'participants';
    IF v_participants IS NULL OR jsonb_typeof(v_participants) != 'array'
       OR jsonb_array_length(v_participants) < 1 THEN
      RETURN json_build_object('error', 'validation', 'message', 'Participant list is empty. Please add each participant.');
    END IF;
    IF jsonb_array_length(v_participants) > 25 THEN
      RETURN json_build_object('error', 'validation', 'message', 'Too many participants for one activity (max 25).');
    END IF;
    FOR v_part_idx IN 0 .. jsonb_array_length(v_participants) - 1 LOOP
      v_participant := v_participants->v_part_idx;
      IF NULLIF(trim(COALESCE(v_participant->>'full_name', '')), '') IS NULL THEN
        RETURN json_build_object('error', 'validation', 'message', 'Every participant needs a name.');
      END IF;
      IF (v_participant->>'participant_type') = 'child'
         AND NULLIF(trim(COALESCE(v_participant->>'guardian_name', '')), '') IS NULL THEN
        RETURN json_build_object('error', 'validation', 'message', 'A guardian name is required for each child participant.');
      END IF;
    END LOOP;
  END LOOP;

  -- ---------- unified customer row ----------
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE lower(phone) = lower(v_phone_clean)
  ORDER BY created_at LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (full_name, phone) VALUES (v_name_clean, v_phone_clean)
    RETURNING id INTO v_customer_id;
  END IF;

  -- ---------- group, attributed to the issuing agent ----------
  INSERT INTO public.booking_groups (group_ref, customer_id, source, agent_id, agent_name)
  VALUES (
    'AG' || nextval('public.booking_group_ref_seq'),
    v_customer_id,
    'agent'::public.booking_source,
    v_link.agent_id,
    v_link.agent_name
  )
  RETURNING id, group_ref INTO v_group_id, v_group_ref;

  -- ---------- per-item insert ----------
  FOR v_idx IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items->v_idx;
    v_act_id := (v_item->>'activity_id')::UUID;

    -- Everything below was already proved valid in the up-front pass; re-read the
    -- activity row for its name + currency.
    SELECT name, currency INTO v_act_name, v_act_currency
    FROM public.activities
    WHERE id = v_act_id AND active = true;

    v_date_clean := trim(COALESCE(v_item->>'booking_date', ''));
    v_time_clean := NULLIF(trim(COALESCE(v_item->>'preferred_time', '')), '');

    -- ---------- price resolution: SERVER SIDE ONLY ----------
    -- Mirrors the staff pricing model (pricing option row, else base price) and
    -- multiplies per-person options by the party. The guest never sees any of
    -- this; it exists so the staff ledger still carries an estimated total.
    -- pricing_unit (migration 007) decides whether the option is per person or
    -- per unit, so a per-person trip is costed for the whole party. Falls back
    -- to the activity's base price when the label matches no pricing row.
    -- Sourced from the link, NOT from p_items. See quoted_option_labels above.
    v_opt_label := NULLIF(trim(COALESCE(
      v_link.quoted_option_labels ->> v_act_id::TEXT, ''
    )), '');
    v_opt_unit := NULL;
    IF v_opt_label IS NOT NULL THEN
      SELECT price_cents, pricing_unit
      INTO v_unit_cents, v_opt_unit
      FROM public.activity_pricing
      WHERE activity_id = v_act_id AND label = v_opt_label;
    END IF;
    IF v_unit_cents IS NULL OR v_unit_cents = 0 THEN
      v_opt_unit := NULL;
      SELECT base_price_cents INTO v_unit_cents
      FROM public.activities WHERE id = v_act_id;
    END IF;
    v_unit_cents := COALESCE(v_unit_cents, 0);

    -- Per-item cost, then the running group total. Only v_item_cents belongs on
    -- this booking — a group of 3 trips must not stamp trip 1 with 1+2+3.
    IF v_opt_unit = 'per_person' THEN
      v_item_cents := v_unit_cents * v_total_guests;
    ELSE
      v_item_cents := v_unit_cents;
    END IF;
    v_total_cents := v_total_cents + v_item_cents;

    -- ---------- booking ----------
    -- guest_agreed / guest_agreed_at / agreement_version are REQUIRED by the
    -- enforce_booking_agreement trigger (062) — an insert that omits them leaves
    -- guest_agreed NULL and the trigger raises, so every agent booking would
    -- fail. p_guest_agreed is already proven true above.
    INSERT INTO public.bookings (
      customer_id, activity_id, source, status, guests,
      adults, children_count,
      booking_date, preferred_time, hotel_name, room_number,
      pickup_location, special_requests, total_cents, booking_ref, group_id,
      agent_id, agent_name,
      guest_agreed, guest_agreed_at, agreement_version,
      created_at, updated_at, booking_currency
    )
    SELECT v_customer_id, v_act_id, 'agent'::public.booking_source, 'pending', v_total_guests,
      (v_total_guests - COALESCE(p_children, 0)), COALESCE(p_children, 0),
      to_date(v_date_clean, 'YYYY-MM-DD')::DATE,
      v_time_clean,
      v_hotel_clean, v_room_clean, v_pickup_clean, v_special_clean,
      v_item_cents, 'A' || upper(substr(md5(random()::text), 1, 7)), v_group_id,
      v_link.agent_id, v_link.agent_name,
      true, now(), 'booking-enquiry-v1',
      now(), now(), v_act_currency
    RETURNING id, booking_ref INTO v_booking_id, v_booking_ref;

    -- ---------- per-participant rows (consent key) ----------
    -- Already validated up front (names present, child guardians present), so this
    -- loop only writes. A participant row is written for every person even when
    -- the party is one, so a solo guest still gets a choice_token and has to sign
    -- the waiver — same guarantee as the walk-in flow (064).
    v_participants := v_item->'participants';
    FOR v_part_idx IN 0 .. jsonb_array_length(v_participants) - 1 LOOP
      v_participant := v_participants->v_part_idx;
      INSERT INTO public.booking_participants (
        booking_id, full_name, participant_type, guardian_name, guardian_relationship
      )
      VALUES (
        v_booking_id,
        trim(v_participant->>'full_name'),
        CASE WHEN (v_participant->>'participant_type') = 'child' THEN 'child'::public.participant_type ELSE 'adult'::public.participant_type END,
        NULLIF(trim(COALESCE(v_participant->>'guardian_name', '')), ''),
        NULLIF(trim(COALESCE(v_participant->>'guardian_relationship', '')), '')
      );
    END LOOP;

    v_result := v_result || jsonb_build_object(
      'booking_id', v_booking_id,
      'booking_ref', v_booking_ref,
      'activity_name', v_act_name,
      'booking_date', v_date_clean,
      'preferred_time', v_time_clean,
      'guest_count', v_total_guests
    );

    v_unit_cents := 0;
    v_item_cents := 0;
  END LOOP;

  -- ---------- link usage counter ----------
  UPDATE public.agent_booking_links
  SET uses_count = uses_count + 1, last_used_at = now()
  WHERE id = v_link_id;

  RETURN json_build_object(
    'group_ref', v_group_ref,
    'guest_name', v_name_clean,
    'agent_name', v_link.agent_name,
    'needs_per_participant_details', true,
    'items', v_result
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_agent_booking(TEXT, JSONB, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_agent_booking(TEXT, JSONB, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_agent_booking(TEXT, JSONB, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

COMMIT;
