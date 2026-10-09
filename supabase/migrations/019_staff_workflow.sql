-- 019_staff_workflow.sql
-- Allow watersports staff to take bookings + payments, link crew to staff,
-- add a captain assignment per trip, and let owner/manager create staff logins.

begin;

-- =============================================
-- 1. Widen RLS for watersports staff
-- =============================================
-- Bookings: grant INSERT + UPDATE (SELECT already existed via assignment)
DROP POLICY IF EXISTS bookings_watersports_staff_insert ON public.bookings;
CREATE POLICY bookings_watersports_staff_insert ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (user_has_role(ARRAY['watersports_staff']::staff_role[]));

DROP POLICY IF EXISTS bookings_watersports_staff_update ON public.bookings;
CREATE POLICY bookings_watersports_staff_update ON public.bookings
  FOR UPDATE TO authenticated
  USING (user_has_role(ARRAY['watersports_staff']::staff_role[]));

-- Customers: full access (was owner/mgr/reception only)
DROP POLICY IF EXISTS customers_watersports_staff_access ON public.customers;
CREATE POLICY customers_watersports_staff_access ON public.customers
  FOR ALL TO authenticated
  USING (user_has_role(ARRAY['watersports_staff']::staff_role[]))
  WITH CHECK (user_has_role(ARRAY['watersports_staff']::staff_role[]));

-- Payments: full access (was owner/mgr/reception only)
DROP POLICY IF EXISTS payments_watersports_staff_access ON public.payments;
CREATE POLICY payments_watersports_staff_access ON public.payments
  FOR ALL TO authenticated
  USING (user_has_role(ARRAY['watersports_staff']::staff_role[]))
  WITH CHECK (user_has_role(ARRAY['watersports_staff']::staff_role[]));

-- =============================================
-- 2. Auto-set bookings.created_by for staff inserts
-- =============================================
CREATE OR REPLACE FUNCTION public.set_booking_created_by() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.current_staff_id();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_created_by ON public.bookings;
CREATE TRIGGER trg_set_created_by BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_booking_created_by();

-- =============================================
-- 3. crew_members: link to staff_profiles
-- =============================================
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS staff_profile_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crew_members_staff_profile ON public.crew_members(staff_profile_id);

-- =============================================
-- 4. trips: add captain_id
-- =============================================
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS captain_id UUID;
DO $$ BEGIN
  ALTER TABLE public.trips ADD CONSTRAINT trips_captain_id_fkey
    FOREIGN KEY (captain_id) REFERENCES public.crew_members(id);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 5. create_trip (add captain)
-- =============================================
CREATE OR REPLACE FUNCTION public.create_trip(
  p_activity_id UUID, p_boat_id UUID, p_trip_date DATE, p_start_time TEXT DEFAULT NULL, p_end_time TEXT DEFAULT NULL,
  p_guide_id UUID DEFAULT NULL, p_captain_id UUID DEFAULT NULL, p_capacity_pax INT DEFAULT NULL, p_seats_open INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_status TEXT DEFAULT 'planned'
) RETURNS JSON AS $$
DECLARE v_role TEXT; v_boat RECORD; v_capacity INT; v_seats INT; v_trip_id UUID; v_trip_ref TEXT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;
  IF p_activity_id IS NULL OR p_trip_date IS NULL THEN RAISE EXCEPTION 'Activity and trip date are required.'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('planned', 'ready') THEN RAISE EXCEPTION 'New trips must start as planned or ready.'; END IF;
  IF p_boat_id IS NOT NULL THEN
    SELECT * INTO v_boat FROM public.boats b WHERE b.id = p_boat_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Boat not found.'; END IF;
    IF v_boat.status = 'maintenance' THEN RAISE EXCEPTION 'Cannot create a trip on % — the boat is in maintenance.', v_boat.name; END IF;
    v_capacity := COALESCE(p_capacity_pax, v_boat.capacity_pax);
    IF v_capacity > v_boat.capacity_pax THEN RAISE EXCEPTION 'Capacity (%) exceeds the boat capacity (%).', v_capacity, v_boat.capacity_pax; END IF;
  ELSE
    v_capacity := COALESCE(p_capacity_pax, 1);
  END IF;
  v_seats := COALESCE(p_seats_open, v_capacity);
  IF v_seats > v_capacity THEN RAISE EXCEPTION 'Open seats cannot exceed capacity.'; END IF;
  INSERT INTO public.trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, captain_id,
                            capacity_pax, seats_open, status, notes, created_by)
  VALUES (p_activity_id, p_boat_id, p_trip_date,
          NULLIF(trim(p_start_time),'')::TIME, NULLIF(trim(p_end_time),'')::TIME,
          p_guide_id, p_captain_id, v_capacity, v_seats, p_status::trip_status, NULLIF(trim(p_notes),''), public.current_staff_id())
  RETURNING id, trip_ref INTO v_trip_id, v_trip_ref;
  RETURN json_build_object('success', true, 'trip_id', v_trip_id, 'trip_ref', v_trip_ref);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public;

-- =============================================
-- 6. update_trip (add captain)
-- =============================================
CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id UUID, p_boat_id UUID DEFAULT NULL, p_start_time TEXT DEFAULT NULL, p_end_time TEXT DEFAULT NULL,
  p_guide_id UUID DEFAULT NULL, p_captain_id UUID DEFAULT NULL, p_capacity_pax INT DEFAULT NULL, p_seats_open INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE v_role TEXT; v_trip RECORD; v_booked INT; v_boat RECORD; v_capacity INT; v_seats INT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;
  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found.'; END IF;
  IF v_trip.status IN ('returned','cancelled') THEN RAISE EXCEPTION 'Cannot edit a % trip.', v_trip.status::TEXT; END IF;
  SELECT COALESCE(SUM(m.pax), 0) INTO v_booked FROM public.trip_manifest m WHERE m.trip_id = p_trip_id;
  IF p_boat_id IS NOT NULL THEN
    SELECT * INTO v_boat FROM public.boats b WHERE b.id = p_boat_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Boat not found.'; END IF;
    IF v_boat.status = 'maintenance' THEN RAISE EXCEPTION 'Cannot assign % — the boat is in maintenance.', v_boat.name; END IF;
    IF v_booked > v_boat.capacity_pax THEN RAISE EXCEPTION 'Boat capacity (%) would be exceeded by % booked pax.', v_boat.capacity_pax, v_booked; END IF;
  END IF;
  v_capacity := COALESCE(p_capacity_pax::INT, v_trip.capacity_pax);
  IF v_capacity < v_booked THEN RAISE EXCEPTION 'Capacity (%) cannot drop below % booked pax.', v_capacity, v_booked; END IF;
  IF p_seats_open IS NOT NULL THEN v_seats := p_seats_open;
  ELSE v_seats := v_trip.seats_open + (v_capacity - v_trip.capacity_pax); END IF;
  IF v_seats < 0 THEN v_seats := 0; END IF;
  UPDATE public.trips SET
    boat_id = COALESCE(p_boat_id, v_trip.boat_id),
    start_time = COALESCE(NULLIF(trim(p_start_time),'')::TIME, v_trip.start_time),
    end_time = COALESCE(NULLIF(trim(p_end_time),'')::TIME, v_trip.end_time),
    guide_id = COALESCE(p_guide_id, v_trip.guide_id),
    captain_id = COALESCE(p_captain_id, v_trip.captain_id),
    capacity_pax = v_capacity, seats_open = v_seats,
    notes = COALESCE(NULLIF(trim(p_notes),''), v_trip.notes)
  WHERE id = p_trip_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public;

-- =============================================
-- 7. create_booking_payment: widen role check
-- =============================================
CREATE OR REPLACE FUNCTION public.create_booking_payment(
  p_booking_id UUID, p_amount_cents INT, p_currency TEXT, p_method TEXT DEFAULT 'cash',
  p_reference TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE v_role TEXT; v_staff_id UUID; v_booking RECORD; v_payment_currency TEXT; v_converted INT; v_new_total_paid INT; v_new_status payment_status; v_payment_id UUID; v_payable_total INT;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();
  IF v_role IS NULL THEN RAISE EXCEPTION 'Access denied: staff profile not found.'; END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('USD', 'MVR') THEN RAISE EXCEPTION 'Payment currency must be USD or MVR.'; END IF;
  IF p_method IS NULL OR p_method = '' THEN p_method := 'cash'; END IF;
  SELECT b.* INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF v_booking.status = 'cancelled' THEN RAISE EXCEPTION 'Cannot record payment for a cancelled booking.'; END IF;
  v_payment_currency := p_currency;
  IF v_payment_currency = v_booking.booking_currency THEN v_converted := p_amount_cents;
  ELSIF v_payment_currency = 'USD' AND v_booking.booking_currency = 'MVR' THEN v_converted := ROUND(p_amount_cents * v_booking.exchange_rate_mvr_per_usd);
  ELSIF v_payment_currency = 'MVR' AND v_booking.booking_currency = 'USD' THEN v_converted := ROUND(p_amount_cents / v_booking.exchange_rate_mvr_per_usd);
  ELSE RAISE EXCEPTION 'Unsupported currency combination.'; END IF;
  IF v_booking.total_cents > 0 THEN v_payable_total := v_booking.total_cents;
  ELSE v_payable_total := v_booking.estimated_total_cents; END IF;
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0) INTO v_new_total_paid FROM public.payments p2 WHERE p2.booking_id = p_booking_id AND p2.status = 'completed';
  IF v_new_total_paid + v_converted > v_payable_total AND v_payable_total > 0 THEN RAISE EXCEPTION USING MESSAGE = format('Overpayment: this payment %s %s + already paid %s %s would exceed total %s %s.', (v_converted / 100.0)::NUMERIC(12,2), v_booking.booking_currency, (v_new_total_paid / 100.0)::NUMERIC(12,2), v_booking.booking_currency, (v_payable_total / 100.0)::NUMERIC(12,2), v_booking.booking_currency); END IF;
  INSERT INTO public.payments (booking_id, amount_cents, currency, method, reference, notes, recorded_by, booking_rate_snapshot, converted_amount_cents, booking_currency, status)
  VALUES (p_booking_id, p_amount_cents, v_payment_currency, p_method, NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''), v_staff_id, v_booking.exchange_rate_mvr_per_usd, v_converted, v_booking.booking_currency, 'completed')
  RETURNING id INTO v_payment_id;
  SELECT COALESCE(SUM(p2.converted_amount_cents), 0) INTO v_new_total_paid FROM public.payments p2 WHERE p2.booking_id = p_booking_id AND p2.status = 'completed';
  IF v_new_total_paid <= 0 THEN v_new_status := 'unpaid';
  ELSIF v_new_total_paid >= v_payable_total THEN v_new_status := 'paid';
  ELSE v_new_status := 'partial'; END IF;
  UPDATE public.bookings SET payment_status = v_new_status, updated_at = now() WHERE id = p_booking_id;
  RETURN json_build_object('success', true, 'payment_id', v_payment_id, 'payment_currency', v_payment_currency, 'amount_cents', p_amount_cents, 'converted_amount_cents', v_converted, 'booking_currency', v_booking.booking_currency, 'new_payment_status', v_new_status::TEXT, 'total_paid_cents', v_new_total_paid, 'payable_total_cents', v_payable_total, 'estimated_total_cents', v_booking.estimated_total_cents, 'total_cents', v_booking.total_cents);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public;

-- =============================================
-- 8. create_staff_login: owner/manager can create auth users + profiles
-- =============================================
CREATE OR REPLACE FUNCTION public.create_staff_login(p_email TEXT, p_password TEXT, p_full_name TEXT, p_role TEXT, p_phone TEXT DEFAULT NULL) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE v_caller_role TEXT; v_user_id UUID; v_staff_id UUID;
BEGIN
  SELECT role INTO v_caller_role FROM public.staff_profiles WHERE user_id = auth.uid() AND active = true;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_email IS NULL OR length(trim(p_email)) < 5 THEN RAISE EXCEPTION 'A valid email is required.'; END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters.'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN RAISE EXCEPTION 'A user with this email already exists.'; END IF;
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, aud, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (gen_random_uuid(), lower(trim(p_email)), crypt(p_password, gen_salt('bf')), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('provider','email','providers',array['email']), jsonb_build_object('full_name', p_full_name), now(), now())
  RETURNING id INTO v_user_id;
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES (v_user_id, v_user_id, v_user_id::text, 'email', jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email))), now(), now(), now());
  INSERT INTO public.staff_profiles (user_id, full_name, role, phone, active) VALUES (v_user_id, p_full_name, p_role::staff_role, p_phone, true) RETURNING id INTO v_staff_id;
  RETURN json_build_object('success', true, 'staff_id', v_staff_id, 'user_id', v_user_id, 'email', lower(trim(p_email)));
END $$;

REVOKE ALL ON FUNCTION public.create_staff_login(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_staff_login(text,text,text,text,text) TO authenticated;

commit;