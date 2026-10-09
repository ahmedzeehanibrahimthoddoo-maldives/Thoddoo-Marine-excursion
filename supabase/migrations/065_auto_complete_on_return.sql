-- ================================================================
-- 065 — AUTO-COMPLETE BOOKINGS ON TRIP RETURN + BACKFILL
-- ================================================================
-- Owner rules (decided 2026-09-28):
--   1. When a trip is marked Returned (Ops Board "↩ Returned" →
--      update_trip_status), EVERY confirmed booking on that trip is
--      automatically marked 'completed'.
--   2. When the LAST guest on a trip is marked returned (Reception board →
--      set_manifest_return, which flips the trip to 'returned'), the same
--      auto-complete fires.
--   3. Existing 'confirmed' bookings on trips already marked 'returned'
--      are backfilled to 'completed' (the "shows confirm but not completed"
--      issue).
--
-- Semantics: only bookings in status 'confirmed' are completed. Pending /
-- cancelled / no_show are left untouched, and the manual "✓ Close
-- bookings" button (close_trip_bookings, migration 046) is kept as an
-- idempotent backstop.
-- ================================================================

BEGIN;

-- ================================================================
-- 1. INTERNAL HELPER — complete the confirmed bookings of a trip
-- ================================================================
-- SECURITY DEFINER so it may be called from any staff-triggered path
-- (including boat_crew, who can mark a return but cannot call the
-- 046 close_trip_bookings RPC). No role check inside — it only ever
-- fires after a trip has reached 'returned'.
CREATE OR REPLACE FUNCTION public.auto_complete_trip_bookings(
  p_trip_id UUID
) RETURNS INT AS $$
DECLARE
  v_closed INT;
BEGIN
  UPDATE public.bookings
     SET status = 'completed',
         updated_at = now()
   WHERE trip_id = p_trip_id
     AND status = 'confirmed';

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.auto_complete_trip_bookings(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_complete_trip_bookings(UUID) FROM anon;
-- only meant to be called from within trusted SECURITY DEFINER functions
GRANT EXECUTE ON FUNCTION public.auto_complete_trip_bookings(UUID) TO authenticated;

-- ================================================================
-- 2. OPS BOARD "RETURNED" → auto-complete bookings
--    (rebuilt from 049 with the completion step added)
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_trip_status(
  p_trip_id  UUID,
  p_status   TEXT
) RETURNS JSON AS $$
DECLARE
  v_role   TEXT;
  v_trip   RECORD;
  v_ok     BOOLEAN;
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

  -- Allowed transitions
  SELECT EXISTS (
    SELECT 1 WHERE
      (v_trip.status = 'planned' AND p_status IN ('ready', 'cancelled'))
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

  -- Trip returns → manifests come back (idempotent, fills NULLs) and every
  -- confirmed booking on the trip is completed automatically.
  IF p_status = 'returned' THEN
    UPDATE public.trip_manifest
    SET departed_at = COALESCE(departed_at, now()),
        returned_at = COALESCE(returned_at, now())
    WHERE trip_id = p_trip_id
      AND returned_at IS NULL;

    v_closed := public.auto_complete_trip_bookings(p_trip_id);
  END IF;

  RETURN json_build_object('success', true, 'status', p_status, 'completed', COALESCE(v_closed, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- ================================================================
-- 3. LAST GUEST RETURNED (Reception board) → auto-complete bookings
--    (rebuilt from 038 with the completion step added)
-- ================================================================
CREATE OR REPLACE FUNCTION public.set_manifest_return(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role        TEXT;
  v_staff_id    UUID;
  v_manifest    RECORD;
  v_trip        RECORD;
  v_outstanding INT;
  v_closed      INT;
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
  IF v_manifest.departed_at IS NULL THEN
    RAISE EXCEPTION 'Guest has not been marked as departed yet.';
  END IF;

  UPDATE public.trip_manifest
  SET returned_at = COALESCE(returned_at, now()),
      returned_by = COALESCE(returned_by, v_staff_id)
  WHERE id = p_manifest_id;

  -- If every guest on the trip has returned, close the trip out and
  -- complete its confirmed bookings automatically.
  SELECT COUNT(*) INTO v_outstanding
  FROM public.trip_manifest m
  WHERE m.trip_id = v_manifest.trip_id
    AND m.returned_at IS NULL;

  IF v_outstanding = 0 THEN
    SELECT * INTO v_trip FROM public.trips t WHERE t.id = v_manifest.trip_id;
    IF v_trip.status = 'departed' THEN
      UPDATE public.trips SET status = 'returned' WHERE id = v_trip.id;
    END IF;
    v_closed := public.auto_complete_trip_bookings(v_manifest.trip_id);
  END IF;

  RETURN json_build_object('success', true, 'manifest_id', p_manifest_id, 'action', 'returned', 'completed', COALESCE(v_closed, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 4. BACKFILL — already-returned trips with 'confirmed' bookings
-- ================================================================
-- Fixes the historical state: bookings that ran on a returned trip but
-- were never closed show as 'confirmed'. Only trips already marked
-- 'returned' are touched; 'confirmed' is the only status flipped.
UPDATE public.bookings b
   SET status = 'completed',
       updated_at = now()
  FROM public.trips t
 WHERE b.trip_id = t.id
   AND t.status = 'returned'
   AND b.status = 'confirmed';

COMMIT;