-- =============================================
-- 052 — Resort Trip price fix + Spatium Bike restore
-- =============================================
-- Fixes two live-data bugs that broke walk-in QR booking:
--
-- 1. resort-trip-ellaidhoo stored base_price_cents = 285000 (the MVR-laari
--    figure for 2850 MVR) in a USD currency row. The public site is USD-only,
--    so this rendered as $2850 / person instead of $150. The RPC fell back to
--    the base price (no activity_pricing row), so walk-in bookings were being
--    estimated at $2850 per guest.
--
-- 2. The real spatium-bike product was overwritten (via CMS) to duplicate the
--    resort trip — name/description/location/base price and its pricing rows
--    were wiped. The walk-in QR dropdown and landing page then showed two
--    identical "Resort Trip to Ellaidhoo" entries and the Spatium Bike product
--    disappeared from the DB.
--
-- This migration restores spatium-bike to its canonical seed values (003) and
-- corrects the resort trip to USD 150 / person (base_price_cents = 15000).
-- Idempotent via ON CONFLICT (slug) so it is safe to re-apply.
-- =============================================

-- -------------------------------------------------
-- 1. Resort Trip to Ellaidhoo — correct to USD 150 / person
-- -------------------------------------------------
INSERT INTO public.activities
  (name, slug, category, description, short_description,
   location, base_price_cents, price_note, currency, image, gopro, active, max_guests)
VALUES
  ('Resort Trip to Ellaidhoo', 'resort-trip-ellaidhoo', 'excursions',
   'Full-day all-inclusive excursion to Cinnamon Ellaidhoo Resort. Includes speedboat transfer from Thoddoo, resort entry, buffet lunch at the resort and a selection of the resort''s all-inclusive drinks. A relaxing day on one of the Maldives'' most established resorts. Departure from Thoddoo at 09:45; return transfer from the resort back to Thoddoo at 16:00.',
   'All-inclusive day at Ellaidhoo Resort — buffet lunch, selected drinks, resort entry and transfer included.',
   'Ellaidhoo Resort, Ari Atoll', 15000, '/ person', 'USD',
   '/images/thoddoo/fun-ride.jpg', false, true, 15)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  base_price_cents = EXCLUDED.base_price_cents,
  price_note = EXCLUDED.price_note,
  currency = EXCLUDED.currency,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active,
  max_guests = EXCLUDED.max_guests;

-- -------------------------------------------------
-- 2. Restore Spatium Bike (canonical seed values from 003)
-- -------------------------------------------------
INSERT INTO public.activities
  (name, slug, category, description, short_description,
   location, base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Spatium Bike', 'spatium-bike', 'watersports',
   'The Spatium Bike lets you ride across the surface of the water. Available for children, single adults and double adults.',
   'Ride a water bike across the lagoon — fun for children and adults alike.',
   'Thoddoo Lagoon', 2000, '/person', 'USD', '/images/thoddoo/fun-ride.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  base_price_cents = EXCLUDED.base_price_cents,
  price_note = EXCLUDED.price_note,
  currency = EXCLUDED.currency,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active,
  max_guests = NULL;

-- 2b. Restore Spatium Bike pricing rows (currently wiped)
DELETE FROM public.activity_pricing
WHERE activity_id IN (SELECT id FROM public.activities WHERE slug = 'spatium-bike');

INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, sort_order)
SELECT id, 'Child', 2000, 'per_unit', 'USD', 0 FROM public.activities WHERE slug = 'spatium-bike'
UNION ALL
SELECT id, 'Single adult', 3000, 'per_unit', 'USD', 1 FROM public.activities WHERE slug = 'spatium-bike'
UNION ALL
SELECT id, 'Double adult', 4000, 'per_unit', 'USD', 2 FROM public.activities WHERE slug = 'spatium-bike';