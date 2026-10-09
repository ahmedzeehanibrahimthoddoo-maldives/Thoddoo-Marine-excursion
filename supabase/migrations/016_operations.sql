-- =============================================
-- Thoddoo Marine – Operations Migration 016
-- Boat operations & watersports execution side.
-- Boats, crew roster, trips, trip manifests, and
-- trip assignment for sellable lines (bookings).
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 0. ENUMS
-- =============================================
DO $$ BEGIN
  CREATE TYPE boat_status AS ENUM ('active', 'maintenance', 'training');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('planned', 'ready', 'departed', 'returned', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 1. BOATS (FLEET)
-- =============================================
-- The fleet includes motor vessels (speedboat, dhoni) AND
-- watersports craft (jet skis, kayaks, SUPs). Every craft
-- has a pax capacity so it can carry trips and be
-- capacity-checked. Status 'maintenance' blocks trip creation.
CREATE TABLE IF NOT EXISTS boats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  boat_type TEXT NOT NULL DEFAULT 'speedboat',
  capacity_pax INT NOT NULL CHECK (capacity_pax > 0),
  status boat_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boats_status ON boats(status);
CREATE INDEX IF NOT EXISTS idx_boats_type ON boats(boat_type);

-- =============================================
-- 2. CREW MEMBERS (OPERATIONAL ROSTER)
-- =============================================
-- Operational crew are separate from auth-linked staff_profiles.
-- staff_profiles = admin CMS accounts; crew_members = who actually
-- runs the boats on the water (guides, captains, operators).
CREATE TABLE IF NOT EXISTS crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crew_active ON crew_members(active);
CREATE INDEX IF NOT EXISTS idx_crew_role ON crew_members(role);

-- =============================================
-- 3. TRIPS
-- =============================================
-- A single scheduled run of a product: activity + date + time +
-- boat + guide + capacity. Trip status drives the ops board flow:
-- planned -> ready -> departed -> returned (or cancelled).
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_ref TEXT NOT NULL UNIQUE,
  activity_id UUID NOT NULL REFERENCES activities(id),
  boat_id UUID REFERENCES boats(id),
  trip_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  guide_id UUID REFERENCES crew_members(id),
  capacity_pax INT NOT NULL CHECK (capacity_pax > 0),
  seats_open INT NOT NULL CHECK (seats_open >= 0),
  status trip_status NOT NULL DEFAULT 'planned',
  notes TEXT,
  created_by UUID REFERENCES staff_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trips_seats CHECK (seats_open <= capacity_pax)
);

CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_activity ON trips(activity_id);
CREATE INDEX IF NOT EXISTS idx_trips_boat ON trips(boat_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

-- =============================================
-- 4. BOOKINGS -> TRIP + PARTNER/FINANCE COLUMNS
-- =============================================
-- The existing `bookings` row IS the sellable line item for Ocean
-- Breeze (product + variant + start_date live on the booking).
-- trip_id is the "booking_items.trip_id" wiring until multi-item
-- bookings are introduced. Partner / net / commission record the
-- agent-side finance (e.g. Botexmoja partners).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS net_cents INT NOT NULL DEFAULT 0 CHECK (net_cents >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_cents INT NOT NULL DEFAULT 0 CHECK (commission_cents >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrival_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrival_time TIME;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS transfer TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_partner ON bookings(partner);

-- =============================================
-- 5. TRIP MANIFEST (GUEST LIST PER TRIP)
-- =============================================
-- One row per booking on a trip, denormalized for the crew sheet:
-- guest name, pax, arrival/transfer details, check-in flag.
CREATE TABLE IF NOT EXISTS trip_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  pax INT NOT NULL CHECK (pax > 0),
  arrival_date DATE,
  arrival_time TIME,
  transfer TEXT,
  hotel TEXT,
  room_number TEXT,
  special_requests TEXT,
  checked_in BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_manifest_trip ON trip_manifest(trip_id);
CREATE INDEX IF NOT EXISTS idx_manifest_booking ON trip_manifest(booking_id);

-- =============================================
-- 6. AUTO-UPDATE TRIGGERS
-- =============================================
DO $$ BEGIN
  CREATE TRIGGER trg_boats_updated
    BEFORE UPDATE ON boats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_crew_members_updated
    BEFORE UPDATE ON crew_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_trips_updated
    BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 7. TRIP REF GENERATOR
-- =============================================
CREATE SEQUENCE IF NOT EXISTS trip_ref_seq START 1001;

CREATE OR REPLACE FUNCTION public.generate_trip_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trip_ref IS NULL OR NEW.trip_ref = '' THEN
    NEW.trip_ref := 'TRP-' || to_char(new.trip_date, 'YYMMDD') || '-' || lpad(nextval('trip_ref_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_trips_ref
    BEFORE INSERT ON trips
    FOR EACH ROW EXECUTE FUNCTION generate_trip_ref();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 8. CREATE TRIP RPC (+ BOAT STATUS GUARD)
-- =============================================
-- Requires authenticated staff (owner/manager/reception/watersports).
-- Rejects boats in 'maintenance'. Capacity defaults to boat capacity
-- when not supplied. Seats default to capacity.
CREATE OR REPLACE FUNCTION public.create_trip(
  p_activity_id  UUID,
  p_boat_id      UUID,
  p_trip_date    DATE,
  p_start_time   TEXT DEFAULT NULL,
  p_end_time     TEXT DEFAULT NULL,
  p_guide_id     UUID DEFAULT NULL,
  p_capacity_pax INT DEFAULT NULL,
  p_seats_open   INT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_status       TEXT DEFAULT 'planned'
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

  -- Boat validation + default capacity from the boat
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
    activity_id, boat_id, trip_date, start_time, end_time, guide_id,
    capacity_pax, seats_open, status, notes, created_by
  ) VALUES (
    p_activity_id, p_boat_id, p_trip_date,
    NULLIF(trim(p_start_time), '')::TIME, NULLIF(trim(p_end_time), '')::TIME,
    p_guide_id, v_capacity, v_seats, p_status::trip_status,
    NULLIF(trim(p_notes), ''), public.current_staff_id()
  )
  RETURNING id, trip_ref INTO v_trip_id, v_trip_ref;

  RETURN json_build_object('success', true, 'trip_id', v_trip_id, 'trip_ref', v_trip_ref);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 9. UPDATE TRIP RPC
-- =============================================
-- Edits boat/guide/capacity/times/notes for non-returned trips.
-- Capacity changes never drop below already-booked pax.
CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id      UUID,
  p_boat_id      UUID DEFAULT NULL,
  p_start_time   TEXT DEFAULT NULL,
  p_end_time     TEXT DEFAULT NULL,
  p_guide_id     UUID DEFAULT NULL,
  p_capacity_pax INT DEFAULT NULL,
  p_seats_open   INT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
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

  -- seats_open: explicit set wins; adjusting capacity shifts seats up by default
  IF p_seats_open IS NOT NULL THEN
    v_seats := p_seats_open;
  ELSE
    v_seats := v_trip.seats_open + (v_capacity - v_trip.capacity_pax);
  END IF;
  IF v_seats < 0 THEN v_seats := 0; END IF;

  UPDATE public.trips SET
    boat_id      = COALESCE(p_boat_id, v_trip.boat_id),
    start_time   = COALESCE(NULLIF(trim(p_start_time), '')::TIME, v_trip.start_time),
    end_time     = COALESCE(NULLIF(trim(p_end_time), '')::TIME, v_trip.end_time),
    guide_id     = COALESCE(p_guide_id, v_trip.guide_id),
    capacity_pax = v_capacity,
    seats_open   = v_seats,
    notes        = COALESCE(NULLIF(trim(p_notes), ''), v_trip.notes)
  WHERE id = p_trip_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 10. TRIP STATUS RPC (FLOW ENFORCEMENT)
-- =============================================
-- planned -> ready -> departed -> returned
-- planned/ready -> cancelled (frees the bookings back to unassigned)
CREATE OR REPLACE FUNCTION public.update_trip_status(
  p_trip_id  UUID,
  p_status   TEXT
) RETURNS JSON AS $$
DECLARE
  v_role   TEXT;
  v_trip   RECORD;
  v_ok     BOOLEAN;
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

  -- Allowed transitions
  SELECT EXISTS (
    SELECT 1 WHERE
      (v_trip.status = 'planned'  AND p_status IN ('ready', 'cancelled'))
      OR (v_trip.status = 'ready'      AND p_status IN ('departed', 'returned', 'cancelled'))
      OR (v_trip.status = 'departed'   AND p_status IN ('returned'))
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Cannot move trip from % to %.', v_trip.status::TEXT, p_status;
  END IF;

  UPDATE public.trips SET status = p_status::trip_status WHERE id = p_trip_id;

  -- Cancelling a trip releases all its bookings back to unassigned
  IF p_status = 'cancelled' THEN
    UPDATE public.bookings SET trip_id = NULL
    WHERE trip_id = p_trip_id AND status != 'cancelled';
    DELETE FROM public.trip_manifest WHERE trip_id = p_trip_id;
  END IF;

  RETURN json_build_object('success', true, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 11. ASSIGN BOOKING TO TRIP (WITH CAPACITY CHECK)
-- =============================================
-- Puts a sellable booking onto a trip + creates its manifest row.
-- Validates: booking is confirmed (not cancelled), trip product+date
-- matches the booking unless force is used, seats available,
-- and the boat can carry the pax. Restores seats when reassigning.
CREATE OR REPLACE FUNCTION public.assign_booking_to_trip(
  p_booking_id UUID,
  p_trip_id    UUID
) RETURNS JSON AS $$
DECLARE
  v_role     TEXT;
  v_booking  RECORD;
  v_trip     RECORD;
  v_manifest trip_manifest%ROWTYPE;
  v_new_seats INT;
  v_capacity INT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
  END IF;

  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot assign a cancelled booking to a trip.';
  END IF;

  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found.';
  END IF;
  IF v_trip.status IN ('returned', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot assign to a % trip.', v_trip.status::TEXT;
  END IF;

  -- Product + date must match the booking
  IF v_trip.activity_id != v_booking.activity_id THEN
    RAISE EXCEPTION 'Trip % is for a different activity than this booking.', v_trip.trip_ref;
  END IF;
  IF v_trip.trip_date != v_booking.booking_date THEN
    RAISE EXCEPTION 'Trip % is on % but the booking is for %.', v_trip.trip_ref, v_trip.trip_date::TEXT, v_booking.booking_date::TEXT;
  END IF;

  v_capacity := v_trip.capacity_pax;

  -- Take back any seats already held by this booking on another trip
  IF v_booking.trip_id IS NOT NULL AND v_booking.trip_id != p_trip_id THEN
    UPDATE public.trips SET seats_open = seats_open + v_booking.guests
    WHERE id = v_booking.trip_id;
    DELETE FROM public.trip_manifest WHERE booking_id = p_booking_id;
  END IF;

  -- Capacity check against the sum of manifest pax
  SELECT COALESCE(SUM(m.pax), 0) INTO v_new_seats
  FROM public.trip_manifest m
  WHERE m.trip_id = p_trip_id AND m.booking_id != p_booking_id;

  IF v_new_seats + v_booking.guests > v_capacity THEN
    RAISE EXCEPTION 'No capacity on trip % (% pax capacity, % already booked, % needed).',
      v_trip.trip_ref, v_capacity::TEXT, v_new_seats::TEXT, v_booking.guests::TEXT;
  END IF;

  -- Also respect the explicit seats_open cushion (walk-in seats)
  IF v_trip.seats_open IS NOT NULL AND v_booking.guests > v_trip.seats_open THEN
    RAISE EXCEPTION 'Only % walk-in seats remain on trip %.', v_trip.seats_open::TEXT, v_trip.trip_ref;
  END IF;

  -- Create / refresh the manifest row
  INSERT INTO public.trip_manifest (
    trip_id, booking_id, guest_name, pax, arrival_date, arrival_time, transfer,
    hotel, room_number, special_requests
  ) VALUES (
    p_trip_id, v_booking.id,
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

  -- Keep seats_open in sync with real occupancy
  UPDATE public.trips SET seats_open = GREATEST(v_capacity - (
    SELECT COALESCE(SUM(m.pax), 0) FROM public.trip_manifest m WHERE m.trip_id = p_trip_id
  ), 0) WHERE id = p_trip_id;

  UPDATE public.bookings SET trip_id = p_trip_id, updated_at = now() WHERE id = p_booking_id;

  RETURN json_build_object('success', true, 'trip_id', p_trip_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 12. UNASSIGN BOOKING FROM TRIP
-- =============================================
CREATE OR REPLACE FUNCTION public.unassign_booking_from_trip(
  p_booking_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role     TEXT;
  v_booking  RECORD;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
  END IF;

  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;
  IF v_booking.trip_id IS NULL THEN
    RETURN json_build_object('success', true, 'message', 'Booking is not assigned to a trip.');
  END IF;

  UPDATE public.trips SET seats_open = seats_open + v_booking.guests
  WHERE id = v_booking.trip_id
    AND status NOT IN ('returned', 'cancelled');

  DELETE FROM public.trip_manifest WHERE booking_id = p_booking_id;
  UPDATE public.bookings SET trip_id = NULL, updated_at = now() WHERE id = p_booking_id;

  RETURN json_build_object('success', true, 'message', 'Booking released from trip.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 13. AUTO-ASSIGN BOOKING TO BEST MATCHING TRIP
-- =============================================
-- "confirmed/paid" bookings snap onto the matching trip for the same
-- product + date (closest departure time when multiple trips exist).
-- Requires status = confirmed AND payment_status = paid.
-- Returns the trip assigned or a reason when none matched.
CREATE OR REPLACE FUNCTION public.auto_assign_booking_to_trip(
  p_booking_id UUID
) RETURNS JSON AS $$
DECLARE
  v_booking RECORD;
  v_trip    RECORD;
BEGIN
  SELECT * INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Booking not found.');
  END IF;

  IF v_booking.status != 'confirmed' OR v_booking.payment_status != 'paid' THEN
    RETURN json_build_object('success', false, 'reason', 'Booking must be confirmed and paid to auto-assign.');
  END IF;

  IF v_booking.trip_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'already_assigned', true, 'trip_id', v_booking.trip_id);
  END IF;

  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.activity_id = v_booking.activity_id
    AND t.trip_date = v_booking.booking_date
    AND t.status NOT IN ('returned', 'cancelled')
    AND (
      t.seats_open >= v_booking.guests
      OR t.capacity_pax - (
        SELECT COALESCE(SUM(m.pax), 0) FROM public.trip_manifest m WHERE m.trip_id = t.id
      ) >= v_booking.guests
    )
  ORDER BY
    -- Prefer the exact requested time, then the closest departure
    CASE WHEN t.start_time::TEXT = v_booking.preferred_time THEN 0 ELSE 1 END,
    ABS(EXTRACT(EPOCH FROM t.start_time) - EXTRACT(EPOCH FROM v_booking.preferred_time::TIME))
  LIMIT 1;

  IF v_trip.id IS NULL THEN
    RETURN json_build_object('success', false, 'reason', 'No matching trip with capacity found for this date.');
  END IF;

  RETURN public.assign_booking_to_trip(v_booking.id, v_trip.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 14. AUTO-ASSIGN ALL MATCHING BOOKINGS FOR A DATE
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_assign_bookings_to_trips(
  p_date DATE DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_date  DATE;
  v_booking RECORD;
  v_result JSON;
  v_assigned INT := 0;
  v_missed   INT := 0;
BEGIN
  v_date := COALESCE(p_date, (now() AT TIME ZONE 'Indian/Maldives')::DATE);

  FOR v_booking IN
    SELECT b.id FROM public.bookings b
    WHERE b.booking_date = v_date
      AND b.status = 'confirmed'
      AND b.payment_status = 'paid'
      AND b.trip_id IS NULL
  LOOP
    v_result := public.auto_assign_booking_to_trip(v_booking.id);
    IF v_result->>'success' = 'true' THEN
      v_assigned := v_assigned + 1;
    ELSE
      v_missed := v_missed + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'date', v_date::TEXT, 'assigned', v_assigned, 'unassigned', v_missed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 15. MANIFEST CHECK-IN
-- =============================================
CREATE OR REPLACE FUNCTION public.toggle_manifest_checkin(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role   TEXT;
  v_row    trip_manifest%ROWTYPE;
  v_new    BOOLEAN;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_row FROM public.trip_manifest m WHERE m.id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest row not found.';
  END IF;

  v_new := NOT v_row.checked_in;
  UPDATE public.trip_manifest
  SET checked_in = v_new,
      checked_in_at = CASE WHEN v_new THEN now() ELSE NULL END
  WHERE id = p_manifest_id;

  RETURN json_build_object('success', true, 'checked_in', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 16. DELETE TRIP RPC
-- =============================================
-- Only for trips with no bookings and not yet departed.
CREATE OR REPLACE FUNCTION public.delete_trip(p_trip_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role   TEXT;
  v_trip   RECORD;
  v_count  INT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found.';
  END IF;
  IF v_trip.status = 'departed' OR v_trip.status = 'returned' THEN
    RAISE EXCEPTION 'Cannot delete a departed/returned trip. Set it cancelled instead.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.bookings WHERE trip_id = p_trip_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete a trip with % booking(s). Unassign or cancel it first.', v_count::TEXT;
  END IF;

  DELETE FROM public.trip_manifest WHERE trip_id = p_trip_id;
  DELETE FROM public.trips WHERE id = p_trip_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 17. RLS POLICIES
-- =============================================
ALTER TABLE boats ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_manifest ENABLE ROW LEVEL SECURITY;

-- BOATS
DROP POLICY IF EXISTS boats_owner_manager_all ON boats;
DROP POLICY IF EXISTS boats_staff_read ON boats;
CREATE POLICY boats_owner_manager_all ON boats
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));
CREATE POLICY boats_staff_read ON boats
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- CREW MEMBERS
DROP POLICY IF EXISTS crew_owner_manager_all ON crew_members;
DROP POLICY IF EXISTS crew_staff_read ON crew_members;
CREATE POLICY crew_owner_manager_all ON crew_members
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));
CREATE POLICY crew_staff_read ON crew_members
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- TRIPS
DROP POLICY IF EXISTS trips_owner_mgr_reception_ws_all ON trips;
DROP POLICY IF EXISTS trips_boat_crew_read ON trips;
CREATE POLICY trips_owner_mgr_reception_ws_all ON trips
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff']::staff_role[]));
CREATE POLICY trips_boat_crew_read ON trips
  FOR SELECT
  USING (
    user_has_role(ARRAY['boat_crew']::staff_role[])
  );

-- TRIP MANIFEST
DROP POLICY IF EXISTS manifest_owner_mgr_reception_ws_all ON trip_manifest;
DROP POLICY IF EXISTS manifest_boat_crew_read ON trip_manifest;
CREATE POLICY manifest_owner_mgr_reception_ws_all ON trip_manifest
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff']::staff_role[]));
CREATE POLICY manifest_boat_crew_read ON trip_manifest
  FOR SELECT
  USING (user_has_role(ARRAY['boat_crew']::staff_role[]));

-- =============================================
-- 18. RPC EXECUTE PERMISSIONS
-- =============================================
REVOKE ALL ON FUNCTION public.create_trip(UUID, UUID, DATE, TEXT, TEXT, UUID, INT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_trip(UUID, UUID, TEXT, TEXT, UUID, INT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_trip_status(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_booking_to_trip(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_booking_from_trip(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_assign_booking_to_trip(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_assign_bookings_to_trips(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_manifest_checkin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_trip(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trip(UUID, UUID, DATE, TEXT, TEXT, UUID, INT, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TEXT, TEXT, UUID, INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_trip_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_booking_to_trip(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_booking_from_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_booking_to_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_bookings_to_trips(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_manifest_checkin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_trip(UUID) TO authenticated;