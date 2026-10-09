-- =============================================
-- Migration 075: Remove the Spatium Bike product
-- The business no longer offers the Spatium hydro-bike, and its card was
-- showing a kayak photo. Deleting the row removes it from the public site,
-- the walk-in QR dropdown and the admin product list in one go.
--
-- Hard delete rather than active=false so it stops appearing in admin
-- pickers and price pickers. Pricing rows must be removed first because
-- they reference the activity by id.
-- =============================================

BEGIN;

DELETE FROM public.activity_pricing
WHERE activity_id = (
  SELECT id FROM public.activities WHERE slug = 'spatium-bike'
);

DELETE FROM public.activities WHERE slug = 'spatium-bike';

COMMIT;
