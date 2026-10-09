-- =============================================
-- Migration 038: Reception — Guest Departure & Return
-- =============================================
-- Adds per-guest departure/return tracking on the trip manifest plus an
-- RPC the reception desk (and crew) can call to mark a guest as having
-- left for the trip and come back.
--
-- Guest-level tracking is independent of the trip-level status: a trip
-- may be 'departed' while individual guests are still being processed.
-- The RPC also nudges the trip status along when safe:
--   first departure  : ready  -> departed
--   last return      : departed -> returned
--
-- Adds: trip_manifest.departed_at / departed_by / returned_at / returned_by
-- Adds: set_manifest_departure, set_manifest_return, reset_manifest_tracking
-- Does NOT modify migrations 001–037.
-- =============================================

BEGIN;

-- =============================================
-- 1. MANIFEST TRACKING COLUMNS
-- =============================================
ALTER TABLE public.trip_manifest
  ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS departed_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_manifest_departed ON public.trip_manifest(departed_at);
CREATE INDEX IF NOT EXISTS idx_manifest_returned ON public.trip_manifest(returned_at);

-- =============================================
-- 2. MARK DEPARTED
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

-- =============================================
-- 3. MARK RETURNED
-- =============================================
CREATE OR REPLACE FUNCTION public.set_manifest_return(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role        TEXT;
  v_staff_id    UUID;
  v_manifest    RECORD;
  v_trip        RECORD;
  v_outstanding INT;
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

  -- If every guest on the trip has returned, close the trip out.
  SELECT COUNT(*) INTO v_outstanding
  FROM public.trip_manifest m
  WHERE m.trip_id = v_manifest.trip_id
    AND m.returned_at IS NULL;

  IF v_outstanding = 0 THEN
    SELECT * INTO v_trip FROM public.trips t WHERE t.id = v_manifest.trip_id;
    IF v_trip.status = 'departed' THEN
      UPDATE public.trips SET status = 'returned' WHERE id = v_trip.id;
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'manifest_id', p_manifest_id, 'action', 'returned');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- 4. RESET TRACKING (misdeparture / misreturn)
-- =============================================
CREATE OR REPLACE FUNCTION public.reset_manifest_tracking(
  p_manifest_id UUID
) RETURNS JSON AS $$
DECLARE
  v_role     TEXT;
  v_manifest RECORD;
BEGIN
  v_role := public.current_staff_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager or reception.';
  END IF;

  SELECT * INTO v_manifest FROM public.trip_manifest m WHERE m.id = p_manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest entry not found.';
  END IF;

  UPDATE public.trip_manifest
  SET departed_at = NULL,
      departed_by = NULL,
      returned_at = NULL,
      returned_by = NULL
  WHERE id = p_manifest_id;

  RETURN json_build_object('success', true, 'manifest_id', p_manifest_id, 'action', 'reset');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- 5. GRANTS
-- =============================================
REVOKE ALL ON FUNCTION public.set_manifest_departure(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_manifest_departure(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_manifest_departure(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.set_manifest_return(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_manifest_return(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_manifest_return(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_manifest_tracking(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_manifest_tracking(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_manifest_tracking(UUID) TO authenticated;

COMMIT;
