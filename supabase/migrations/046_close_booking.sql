-- =============================================
-- Migration 046: Close booking on trip return
-- =============================================
-- Completes the ops lifecycle:
--   book + consent -> payment -> assign guide/captain -> ready -> depart
--   -> return -> close booking
--
-- Adds:
--   1. close_trip_bookings() — marks every non-cancelled booking on a fully
--      returned trip as 'completed' (idempotent, role-gated).
--
-- Does NOT modify migrations 001–045.
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.close_trip_bookings(
  p_trip_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role  TEXT;
  v_trip  RECORD;
  v_closed INT;
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

  -- Professional guardrail: only a returned trip can be closed.
  IF v_trip.status != 'returned' THEN
    RAISE EXCEPTION 'Trip % must be returned before its bookings can be closed.', v_trip.trip_ref;
  END IF;

  UPDATE public.bookings
     SET status = 'completed',
         updated_at = now()
   WHERE trip_id = p_trip_id
     AND status != 'cancelled';

  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN json_build_object('success', true, 'trip_ref', v_trip.trip_ref, 'closed', v_closed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.close_trip_bookings(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_trip_bookings(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_trip_bookings(UUID) TO authenticated;

COMMIT;