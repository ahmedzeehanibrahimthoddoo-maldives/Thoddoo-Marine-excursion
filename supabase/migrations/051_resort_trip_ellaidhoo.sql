-- =============================================
-- 051 — Resort Trip: Ellaidhoo Resort (Cinnamon)
-- =============================================
-- Author: Thoddoo Marine CMS content request
-- Status: APPLIED (base price corrected in 052 from 285000 laari to 15000 USD cents).
--
-- All-inclusive day trip to Cinnamon Ellaidhoo Resort.
-- Includes speedboat transfer from Thoddoo, resort entry,
-- buffet lunch and selected all-inclusive drinks by the resort.
--
-- Price: USD 150 / person (base_price_cents = 15000).
-- Departure: 09:45 from Thoddoo · Return: 16:00 from resort.
-- =============================================

INSERT INTO public.activities
  (name, slug, category, description, short_description,
   location, base_price_cents, price_note, image, gopro, active)
VALUES
  ('Resort Trip to Ellaidhoo', 'resort-trip-ellaidhoo', 'excursions',
   'Full-day all-inclusive excursion to Cinnamon Ellaidhoo Resort. Includes speedboat transfer from Thoddoo, resort entry, buffet lunch at the resort and a selection of the resort''s all-inclusive drinks. A relaxing day on one of the Maldives'' most established resorts. Departure from Thoddoo at 09:45; return transfer from the resort back to Thoddoo at 16:00.',
   'All-inclusive day at Ellaidhoo Resort — buffet lunch, selected drinks, resort entry and transfer included.',
   'Ellaidhoo Resort, Ari Atoll', 15000, '/ person',
   '/images/thoddoo/fun-ride.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  base_price_cents = EXCLUDED.base_price_cents,
  price_note = EXCLUDED.price_note,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active;
