-- ================================================================
-- 049 — Cascade trip-level departure/return down to trip manifests
-- ================================================================
-- WHY: Reception derives every guest's "Expected/Out/Returned" state
-- ONLY from trip_manifest.departed_at / returned_at (see
-- app/admin/reception/ReceptionBoardClient.tsx guestState()).
--
-- The Ops/Trips board, however, marks a whole trip Departed/Returned
-- (status = done) through public.update_trip_status (migration 016),
-- which ONLY updates public.trips.status. It never stamps manifests.
--
-- Result: a trip flipped to "Returned"/"Done" on the Ops/Trips boards
-- leaves every guest on the Reception board stuck as "Expected"/"Out"
-- until a receptionist manually taps Return row-by-row. THIS is the
-- "reception pending / not syncing with trips done" the staff hit.
--
-- Fix: CREATE OR REPLACE the same RPC so the trip-level transition
-- cascades into the manifests, using EXACTLY the idempotent COALESCE
-- semantics of the per-guest RPCs (set_manifest_departure / _return,
-- migration 038) — never overwrites an already-stamped row, only
-- fills NULLs.
-- ================================================================

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

  -- ==============================================================
  -- NEW: cascade trip-level status changes to manifests
  -- (idempotent — only fills NULLs, preserves staff-set stamps).
  -- ==============================================================
  -- Trip departs → every manifest that hasn't left yet leaves now.
  IF p_status = 'departed' THEN
    UPDATE public.trip_manifest
    SET departed_at = COALESCE(departed_at, now())
    WHERE trip_id = p_trip_id
      AND departed_at IS NULL
      AND returned_at IS NULL;
  END IF;

  -- Trip returns → every manifest still out comes back now
  -- (departure is implied; even a manifest that never got a
  --  departed_at stamp is a returned guest on the return).
  IF p_status = 'returned' THEN
    UPDATE public.trip_manifest
    SET departed_at = COALESCE(departed_at, now()),
        returned_at = COALESCE(returned_at, now())
    WHERE trip_id = p_trip_id
      AND returned_at IS NULL;
  END IF;

  RETURN json_build_object('success', true, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
