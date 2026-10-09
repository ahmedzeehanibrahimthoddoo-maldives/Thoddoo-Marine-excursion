-- =============================================
-- Migration 039: Auto-create draft trip on booking confirmation
-- =============================================
-- When a booking is confirmed (regardless of payment), the operations
-- trip list is populated automatically:
--   1. If an open trip already exists for the same activity + date with
--      capacity, the booking is attached to it.
--   2. Otherwise a new DRAFT trip is created (boat unassigned, seats
--      sized from the activity's max_guests or the party size) and the
--      booking is attached.
--
-- Managers then assign boat / captain / guide afterwards on the Trips
-- board, and payment gates departure as before.
--
-- Adds: ensure_trip_for_booking_core (no auth — trigger-safe)
--       ensure_trip_for_booking      (authenticated RPC wrapper)
--       trg_bookings_auto_trip       (AFTER UPDATE OF status)
-- Does NOT modify migrations 001–038.
-- =============================================

BEGIN;

-- =============================================
-- 1. CORE: attach booking to a trip, creating a draft if needed
-- =============================================
-- No role check: safe to call from a trigger. SECURITY DEFINER so it
-- can write trips/manifest regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION public.ensure_trip_for_booking_core(
  p_booking_id UUID
) RETURNS JSON AS $$
DECLARE
  v_booking  RECORD;
  v_trip     RECORD;
  v_capacity INT;
  v_trip_id  UUID;
  v_trip_ref TEXT;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Booking not found.');
  END IF;
  IF v_booking.status != 'confirmed' THEN
    RETURN json_build_object('success', false, 'reason', 'Booking is not confirmed.');
  END IF;
  IF v_booking.trip_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'already_assigned', true, 'trip_id', v_booking.trip_id);
  END IF;
  IF v_booking.booking_date IS NULL THEN
    RETURN json_build_object('success', false, 'reason', 'Booking has no date.');
  END IF;

  -- (1) Prefer an existing open trip with capacity
  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.activity_id = v_booking.activity_id
    AND t.trip_date = v_booking.booking_date
    AND t.status IN ('planned', 'ready')
    AND (
      t.seats_open IS NULL OR t.seats_open >= v_booking.guests
      OR t.capacity_pax - (
        SELECT COALESCE(SUM(m.pax), 0) FROM public.trip_manifest m WHERE m.trip_id = t.id
      ) >= v_booking.guests
    )
  ORDER BY
    CASE WHEN t.start_time::TEXT = v_booking.preferred_time THEN 0 ELSE 1 END,
    t.start_time NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_trip.id IS NULL THEN
    -- (2) Create a draft trip sized to the party / activity capacity
    SELECT GREATEST(COALESCE(a.max_guests, 0), v_booking.guests, 1)
    INTO v_capacity
    FROM public.activities a
    WHERE a.id = v_booking.activity_id;

    IF v_capacity IS NULL THEN
      v_capacity := GREATEST(v_booking.guests, 1);
    END IF;

    INSERT INTO public.trips (
      activity_id, boat_id, trip_date, start_time, capacity_pax, seats_open,
      status, notes, created_by
    ) VALUES (
      v_booking.activity_id, NULL, v_booking.booking_date,
      NULLIF(TRIM(v_booking.preferred_time), '')::TIME,
      v_capacity, v_capacity, 'planned',
      'Auto-created on booking confirmation — assign boat, captain and guide.',
      v_booking.created_by
    )
    RETURNING id, trip_ref INTO v_trip_id, v_trip_ref;
  ELSE
    v_trip_id := v_trip.id;
    v_trip_ref := v_trip.trip_ref;
    v_capacity := v_trip.capacity_pax;
  END IF;

  -- Create / refresh the manifest row (mirrors assign_booking_to_trip)
  INSERT INTO public.trip_manifest (
    trip_id, booking_id, guest_name, pax, arrival_date, arrival_time, transfer,
    hotel, room_number, special_requests
  ) VALUES (
    v_trip_id, v_booking.id,
    (SELECT c.full_name FROM public.customers c WHERE c.id = v_booking.customer_id) || '',
    v_booking.guests,
    v_booking.arrival_date, v_booking.arrival_time, v_booking.transfer,
    COALESCE(v_booking.hotel_name, (SELECT c.hotel FROM public.customers c WHERE c.id = v_booking.customer_id)),
    COALESCE(v_booking.room_number, (SELECT c.room_number FROM public.customers c WHERE c.id = v_booking.customer_id)),
    v_booking.special_requests
  )
  ON CONFLICT (trip_id, booking_id)
  DO UPDATE SET
    guest_name = EXCLUDED.guest_name,
    pax = EXCLUDED.pax,
    arrival_date = EXCLUDED.arrival_date,
    arrival_time = EXCLUDED.arrival_time,
    transfer = EXCLUDED.transfer,
    hotel = EXCLUDED.hotel,
    room_number = EXCLUDED.room_number,
    special_requests = EXCLUDED.special_requests;

  -- Recompute open seats from real manifest occupancy
  UPDATE public.trips
  SET seats_open = GREATEST(v_capacity - (
    SELECT COALESCE(SUM(m.pax), 0) FROM public.trip_manifest m WHERE m.trip_id = v_trip_id
  ), 0)
  WHERE id = v_trip_id;

  UPDATE public.bookings SET trip_id = v_trip_id, updated_at = now() WHERE id = p_booking_id;

  RETURN json_build_object(
    'success', true,
    'trip_id', v_trip_id,
    'trip_ref', v_trip_ref,
    'created', v_trip.id IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.ensure_trip_for_booking_core(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_trip_for_booking_core(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_trip_for_booking_core(UUID) FROM authenticated;

-- =============================================
-- 2. AUTHENTICATED WRAPPER
-- =============================================
CREATE OR REPLACE FUNCTION public.ensure_trip_for_booking(
  p_booking_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;
  RETURN public.ensure_trip_for_booking_core(p_booking_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.ensure_trip_for_booking(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_trip_for_booking(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_trip_for_booking(UUID) TO authenticated;

-- =============================================
-- 3. AUTO-TRIP TRIGGER ON CONFIRMATION
-- =============================================
CREATE OR REPLACE FUNCTION public.bookings_auto_trip_on_confirm()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.ensure_trip_for_booking_core(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Auto-trip is best-effort: never block the confirmation itself.
  RAISE WARNING 'ensure_trip_for_booking failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_bookings_auto_trip ON public.bookings;
CREATE TRIGGER trg_bookings_auto_trip
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed')
  EXECUTE FUNCTION public.bookings_auto_trip_on_confirm();

COMMIT;

-- =============================================
-- VERIFICATION
-- =============================================
-- UPDATE bookings SET status = 'confirmed' WHERE id = '<uuid>';
-- SELECT trip_id FROM bookings WHERE id = '<uuid>';
-- SELECT * FROM trips WHERE id = '<trip>';
