-- ============================================================
-- 043: Extend incident_reports for equipment-damage incidents
-- ============================================================
-- The incident_reports table (001) already links to bookings,
-- customers and activities and carries severity/resolution state.
-- This migration adds the operational fields needed to document a
-- guest-caused equipment damage incident (engine failure etc.) and
-- its repair estimate. Repair charges are attached to the booking
-- via booking_charges (041), not duplicated here.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS vessel_ref          TEXT,
  ADD COLUMN IF NOT EXISTS alarm_warning_seen  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alarm_notes         TEXT,
  ADD COLUMN IF NOT EXISTS mechanical_damage   TEXT,
  ADD COLUMN IF NOT EXISTS evidence_notes      TEXT,
  ADD COLUMN IF NOT EXISTS photos              JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repair_quote_cents  INT,
  ADD COLUMN IF NOT EXISTS repair_quote_currency TEXT NOT NULL DEFAULT 'USD';

CREATE INDEX IF NOT EXISTS idx_incidents_booking ON public.incident_reports(booking_id);

-- Keep resolved_at in sync with the resolved flag.
CREATE OR REPLACE FUNCTION public.sync_incident_resolved_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.resolved AND NOT COALESCE(OLD.resolved, false) THEN
    NEW.resolved_at := now();
  ELSIF NOT NEW.resolved THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incidents_resolved_at ON public.incident_reports;
CREATE TRIGGER trg_incidents_resolved_at
  BEFORE UPDATE OF resolved ON public.incident_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_incident_resolved_at();