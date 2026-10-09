-- 031_reopen_trips.sql
-- Allow reopening a 'returned' trip back to 'planned' (e.g. the board marked a
-- test/practice run returned, or a trip needs to be reused for same-day
-- bookings). Cancelled trips require a planned trip idempotently, too.

begin;

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

COMMENT ON FUNCTION public.update_trip_status(UUID, TEXT) IS 'Transition trips through the ops lifecycle. Reopening a returned trip back to planned is supported.';

commit;