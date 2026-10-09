-- =============================================
-- 053 — Spatium Bike max_guests cleanup
-- =============================================
-- Migration 052 restored spatium-bike to its canonical seed values (003),
-- which carry no guest cap (max_guests NULL). The stray resort-trip edit left
-- a leftover max_guests = 15 on the watersport row; this clears it so live
-- data matches the restore promise. Idempotent by nature.
-- =============================================

UPDATE public.activities
SET max_guests = NULL
WHERE slug = 'spatium-bike'
  AND max_guests IS DISTINCT FROM NULL;