-- =============================================
-- Migration 045: Crew assignment flow
-- =============================================
-- Turns the trip lifecycle into a professional, ordered flow:
--   booking -> payment -> assign guide/captain -> ready -> depart -> return
--
-- Adds:
--   1. assign_trip_crew()      — inline, idempotent guide/captain assignment.
--   2. update_trip_status()    — guardrail: a trip cannot be marked 'ready'
--                                until a guide OR captain is assigned.
--   3. set_manifest_departure()— guardrail: guests can only depart a trip that
--                                is 'ready'/'departed' AND has crew assigned.
--
-- Does NOT modify migrations 001–044.
-- =============================================

BEGIN;

-- =============================================
-- 1. INLINE CREW ASSIGNMENT
-- =============================================
CREATE OR REPLACE FUNCTION public.assign_trip_crew(
  p_trip_id    UUID,
  p_guide_id   UUID,
  p_captain_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, reception or watersports staff.';
  END IF;

  UPDATE public.trips
     SET guide_id    = p_guide_id,
         captain_id  = p_captain_id,
         updated_at  = now()
   WHERE id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found.';
  END IF;

  RETURN json_build_object('success', true, 'trip_id', p_trip_id,
                           'guide_id', p_guide_id, 'captain_id', p_captain_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.assign_trip_crew(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_trip_crew(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_trip_crew(UUID, UUID, UUID) TO authenticated;

-- =============================================
-- 2. READY GUARDRAIL (update_trip_status)
-- =============================================
CREATE OR REPLACE FUNCTION public.update_trip_status(
  p_trip_id UUID,
  p_status  TEXT
) RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_trip RECORD;
  v_ok   BOOLEAN;
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
      OR (v_trip.status = 'returned'   AND p_status IN ('planned'))
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Cannot move trip from % to %.', v_trip.status::TEXT, p_status;
  END IF;

  -- Professional guardrail: crew must be assigned before the trip can run
  IF p_status = 'ready' AND v_trip.guide_id IS NULL AND v_trip.captain_id IS NULL THEN
    RAISE EXCEPTION 'Assign a guide or captain to % before marking it ready.', v_trip.trip_ref;
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

COMMENT ON FUNCTION public.update_trip_status(UUID, TEXT) IS 'Transition trips through the ops lifecycle. Reopening a returned trip back to planned is supported. A trip must have a guide or captain before it can be marked ready.';

-- =============================================
-- 3. DEPARTURE GUARDRAIL (set_manifest_departure)
-- =============================================
CREATE OR REPLACE FUNCTION public.set_manifest_departure(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role     TEXT;
  v_staff_id UUID;
  v_manifest RECORD;
  v_trip     RECORD;
BEGIN
  v_role := public.current_staff_role();
  v_staff_id := public.current_staff_id();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception', 'watersports_staff', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_manifest FROM public.trip_manifest m WHERE m.id = p_manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest entry not found.';
  END IF;

  SELECT * INTO v_trip FROM public.trips t WHERE t.id = v_manifest.trip_id FOR UPDATE;
  IF v_trip.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot depart a guest from a cancelled trip.';
  END IF;

  -- Professional guardrail: guests only depart trips that are running with crew
  IF v_trip.status NOT IN ('ready', 'departed') THEN
    RAISE EXCEPTION 'Mark trip % ready before departing its guests.', v_trip.trip_ref;
  END IF;
  IF v_trip.guide_id IS NULL AND v_trip.captain_id IS NULL THEN
    RAISE EXCEPTION 'Assign a guide or captain to % before departing its guests.', v_trip.trip_ref;
  END IF;

  IF v_manifest.returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'Guest already returned. Reset tracking before departing again.';
  END IF;

  -- Departing implies check-in
  UPDATE public.trip_manifest
  SET checked_in = true,
      checked_in_at = COALESCE(checked_in_at, now()),
      departed_at = COALESCE(departed_at, now()),
      departed_by = COALESCE(departed_by, v_staff_id)
  WHERE id = p_manifest_id;

  -- Nudge the trip forward when it is still ready
  IF v_trip.status = 'ready' THEN
    UPDATE public.trips SET status = 'departed' WHERE id = v_trip.id;
  END IF;

  RETURN json_build_object('success', true, 'manifest_id', p_manifest_id, 'action', 'departed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;