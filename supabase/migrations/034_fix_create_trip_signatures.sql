-- 034_fix_create_trip_signatures.sql
-- Consolidates create_trip / update_trip to a single signature that accepts
-- BOTH p_captain_id (added in 019) and the transfer columns (added in 033).
-- 033 recreated these functions from the pre-019 definition, accidentally
-- dropping p_captain_id and creating parallel overloads.

BEGIN;

DROP FUNCTION IF EXISTS public.create_trip(
  p_activity_id UUID, p_boat_id UUID, p_trip_date DATE,
  p_start_time TEXT, p_end_time TEXT, p_guide_id UUID,
  p_capacity_pax INT, p_seats_open INT, p_notes TEXT, p_status TEXT);

DROP FUNCTION IF EXISTS public.create_trip(
  p_activity_id UUID, p_boat_id UUID, p_trip_date DATE,
  p_start_time TEXT, p_end_time TEXT, p_guide_id UUID,
  p_capacity_pax INT, p_seats_open INT, p_notes TEXT, p_status TEXT,
  p_destination TEXT, p_transfer_price_cents INT, p_transfer_currency TEXT);

DROP FUNCTION IF EXISTS public.update_trip(
  p_trip_id UUID, p_boat_id UUID, p_start_time TEXT, p_end_time TEXT,
  p_guide_id UUID, p_capacity_pax INT, p_seats_open INT, p_notes TEXT);

DROP FUNCTION IF EXISTS public.update_trip(
  p_trip_id UUID, p_boat_id UUID, p_start_time TEXT, p_end_time TEXT,
  p_guide_id UUID, p_capacity_pax INT, p_seats_open INT, p_notes TEXT,
  p_destination TEXT, p_transfer_price_cents INT, p_transfer_currency TEXT);

-- Recreate create_trip with full signature (captain + transfer)
CREATE OR REPLACE FUNCTION public.create_trip(
  p_activity_id        UUID,
  p_boat_id            UUID,
  p_trip_date          DATE,
  p_start_time         TEXT DEFAULT NULL,
  p_end_time           TEXT DEFAULT NULL,
  p_guide_id           UUID DEFAULT NULL,
  p_captain_id         UUID DEFAULT NULL,
  p_capacity_pax       INT DEFAULT NULL,
  p_seats_open         INT DEFAULT NULL,
  p_notes              TEXT DEFAULT NULL,
  p_status             TEXT DEFAULT 'planned',
  p_destination        TEXT DEFAULT NULL,
  p_transfer_price_cents INT DEFAULT NULL,
  p_transfer_currency  TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role      TEXT;
  v_boat      RECORD;
  v_capacity  INT;
  v_seats     INT;
  v_trip_id   UUID;
  v_trip_ref  TEXT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
  END IF;

  IF p_activity_id IS NULL OR p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Activity and trip date are required.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('planned', 'ready') THEN
    RAISE EXCEPTION 'New trips must start as planned or ready.';
  END IF;

  IF p_boat_id IS NOT NULL THEN
    SELECT * INTO v_boat FROM public.boats b WHERE b.id = p_boat_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Boat not found.';
    END IF;
    IF v_boat.status = 'maintenance' THEN
      RAISE EXCEPTION 'Cannot create a trip on % — the boat is in maintenance.', v_boat.name;
    END IF;
    v_capacity := COALESCE(p_capacity_pax, v_boat.capacity_pax);
    IF v_capacity > v_boat.capacity_pax THEN
      RAISE EXCEPTION 'Capacity (%) exceeds the % capacity (%) of this boat.', v_capacity, (v_boat.capacity_pax)::TEXT, (v_boat.capacity_pax)::TEXT;
    END IF;
  ELSE
    v_capacity := COALESCE(p_capacity_pax, 1);
  END IF;

  v_seats := COALESCE(p_seats_open, v_capacity);
  IF v_seats > v_capacity THEN
    RAISE EXCEPTION 'Open seats cannot exceed capacity.';
  END IF;

  INSERT INTO public.trips (
    activity_id, boat_id, trip_date, start_time, end_time, guide_id, captain_id,
    capacity_pax, seats_open, status, notes, created_by,
    destination, transfer_price_cents, transfer_currency
  ) VALUES (
    p_activity_id, p_boat_id, p_trip_date,
    NULLIF(trim(p_start_time), '')::TIME, NULLIF(trim(p_end_time), '')::TIME,
    p_guide_id, p_captain_id, v_capacity, v_seats, p_status::trip_status,
    NULLIF(trim(p_notes), ''), public.current_staff_id(),
    NULLIF(trim(p_destination), ''), p_transfer_price_cents,
    COALESCE(NULLIF(trim(p_transfer_currency), ''), 'USD')
  )
  RETURNING id, trip_ref INTO v_trip_id, v_trip_ref;

  RETURN json_build_object('success', true, 'trip_id', v_trip_id, 'trip_ref', v_trip_ref);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Recreate update_trip with full signature (captain + transfer)
CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id            UUID,
  p_boat_id            UUID DEFAULT NULL,
  p_start_time         TEXT DEFAULT NULL,
  p_end_time           TEXT DEFAULT NULL,
  p_guide_id           UUID DEFAULT NULL,
  p_captain_id         UUID DEFAULT NULL,
  p_capacity_pax       INT DEFAULT NULL,
  p_seats_open         INT DEFAULT NULL,
  p_notes              TEXT DEFAULT NULL,
  p_destination        TEXT DEFAULT NULL,
  p_transfer_price_cents INT DEFAULT NULL,
  p_transfer_currency  TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_role      TEXT;
  v_trip      RECORD;
  v_booked    INT;
  v_boat      RECORD;
  v_capacity  INT;
  v_seats     INT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
  END IF;

  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found.';
  END IF;
  IF v_trip.status IN ('returned', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot edit a % trip.', v_trip.status::TEXT;
  END IF;

  SELECT COALESCE(SUM(m.pax), 0) INTO v_booked FROM public.trip_manifest m WHERE m.trip_id = p_trip_id;

  IF p_boat_id IS NOT NULL THEN
    SELECT * INTO v_boat FROM public.boats b WHERE b.id = p_boat_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Boat not found.';
    END IF;
    IF v_boat.status = 'maintenance' THEN
      RAISE EXCEPTION 'Cannot assign % — the boat is in maintenance.', v_boat.name;
    END IF;
    IF v_booked > v_boat.capacity_pax THEN
      RAISE EXCEPTION 'Boat capacity (%) would be exceeded by % booked pax.', v_boat.capacity_pax::TEXT, v_booked::TEXT;
    END IF;
  END IF;

  v_capacity := COALESCE(p_capacity_pax::INT, v_trip.capacity_pax);
  IF v_capacity < v_booked THEN
    RAISE EXCEPTION 'Capacity (%) cannot drop below % booked pax.', v_capacity::TEXT, v_booked::TEXT;
  END IF;

  IF p_seats_open IS NOT NULL THEN
    v_seats := p_seats_open;
  ELSE
    v_seats := v_trip.seats_open + (v_capacity - v_trip.capacity_pax);
  END IF;
  IF v_seats < 0 THEN v_seats := 0; END IF;

  UPDATE public.trips SET
    boat_id               = COALESCE(p_boat_id, v_trip.boat_id),
    start_time            = COALESCE(NULLIF(trim(p_start_time), '')::TIME, v_trip.start_time),
    end_time              = COALESCE(NULLIF(trim(p_end_time), '')::TIME, v_trip.end_time),
    guide_id              = COALESCE(p_guide_id, v_trip.guide_id),
    captain_id            = COALESCE(p_captain_id, v_trip.captain_id),
    capacity_pax          = v_capacity,
    seats_open            = v_seats,
    notes                 = COALESCE(NULLIF(trim(p_notes), ''), v_trip.notes),
    destination           = NULLIF(trim(p_destination), ''),
    transfer_price_cents  = p_transfer_price_cents,
    transfer_currency     = COALESCE(NULLIF(trim(p_transfer_currency), ''), v_trip.transfer_currency)
  WHERE id = p_trip_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

COMMIT;