-- ================================================================
-- 057 — Full activity price list (canonical, idempotent)
-- ================================================================
-- Upserts the Thoddoo Marine rate card into activities. Existing slugs are
-- UPDATED (prices/descriptions), never duplicated. New items carry the
-- rates exactly as published. Idempotent by slug — safe to re-run.
-- Option-bearing watersports get canonical activity_pricing rows via
-- DELETE+INSERT so stale/renamed options never linger.
-- ================================================================

-- W A T E R S P O R T S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Jet Ski', 'jet-ski', 'watersports',
   'Enjoy a thrilling jet ski ride across the lagoon. Choose from 10, 15 or 30-minute sessions, a full 1 hour, or the Jet Adventure ride with optional snorkeling. No experience needed — our team briefs you before you go.',
   'Adrenaline on the water — perfect for first-timers and thrill lovers alike.',
   'Thoddoo Lagoon', 3500, '/ person', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Funtube', 'funtube', 'watersports',
   'A fun, bumpy towed tube ride across the lagoon behind one of our boats. Available for 2 or 4 persons.',
   'Hold on — a bouncy towed tube ride for friends and families.',
   'Thoddoo Lagoon', 5500, '/ unit', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Banana Ride', 'banana-ride', 'watersports',
   'The classic banana boat — bounce and splash across the waves as the boat picks up speed. Available for 2 or 4 persons.',
   'Bounce and splash on the classic banana boat ride.',
   'Thoddoo Lagoon', 5500, '/ unit', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Water Skiing', 'water-skiing', 'watersports',
   'Glide across the calm lagoon on water skis behind one of our boats. Choose a short lesson, a timed ride, or a 5-round package.',
   'Glide across the lagoon on water skis.',
   'Thoddoo Lagoon', 1500, '/ person', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Wakeboarding', 'wakeboarding', 'watersports',
   'Ride the wake on a wakeboard — a mix of water skiing and surfing behind the boat. Lessons, timed rides and 5-round packages.',
   'Ride the wake on a wakeboard.',
   'Thoddoo Lagoon', 1500, '/ person', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Kayak', 'kayak', 'watersports',
   'Explore the lagoon by kayak — single, double or transparent double. Paddle as long as you like; pricing is per hour.',
   'Paddle at your own pace through calm turquoise waters.',
   'Thoddoo Lagoon', 1000, '/ hour', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('SUP / Stand-Up Paddleboard', 'stand-up-paddleboard', 'watersports',
   'Stand-up paddleboarding in the calm waters of Thoddoo Lagoon. Relaxed and suitable for all skill levels. Per hour.',
   'Stand up and paddle across the glassy lagoon.',
   'Thoddoo Lagoon', 1500, '/ hour', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('SUP with Scooter', 'sup-with-scooter', 'watersports',
   'Stand-up paddleboard fitted with an underwater scooter — a unique way to glide across the water. Per hour.',
   'SUP with an underwater scooter for a unique ride.',
   'Thoddoo Lagoon', 3000, '/ hour', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('Spatium Bike', 'spatium-bike', 'watersports',
   'Ride across the surface of the water on a Spatium water bike. Available for children, single adults and double adults.',
   'Ride a water bike across the lagoon.',
   'Thoddoo Lagoon', 2000, '/ person', 'USD', '/images/thoddoo/fun-ride.jpg', false, true)
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
  active = EXCLUDED.active;

-- W A T E R S P O R T   P R I C I N G   O P T I O N S
DO $$
DECLARE
  act_id UUID;
BEGIN
  SELECT id INTO act_id FROM public.activities WHERE slug = 'jet-ski';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, '10 minutes', 3500, 'per_unit', 'USD', NULL, 0),
      (act_id, '15 minutes', 4500, 'per_unit', 'USD', NULL, 1),
      (act_id, '30 minutes', 6500, 'per_unit', 'USD', NULL, 2),
      (act_id, '1 hour', 12000, 'per_unit', 'USD', NULL, 3),
      (act_id, '1-hour Jet Adventure Ride', 12000, 'per_unit', 'USD', NULL, 4),
      (act_id, '1-hour Jet Adventure + Snorkeling', 15000, 'per_unit', 'USD', NULL, 5);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'funtube';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, '2 persons (10 min)', 5500, 'per_unit', 'USD', NULL, 0),
      (act_id, '4 persons (10 min)', 7500, 'per_unit', 'USD', NULL, 1);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'banana-ride';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, '2 persons (10 min)', 5500, 'per_unit', 'USD', NULL, 0),
      (act_id, '4 persons (10 min)', 7500, 'per_unit', 'USD', NULL, 1);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'water-skiing';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, '5-minute lesson', 1500, 'per_unit', 'USD', NULL, 0),
      (act_id, '15-minute ride', 4000, 'per_unit', 'USD', NULL, 1),
      (act_id, '15 minutes (5 rounds)', 16000, 'per_unit', 'USD', NULL, 2);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'wakeboarding';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, '5-minute lesson', 1500, 'per_unit', 'USD', NULL, 0),
      (act_id, '15-minute ride', 4000, 'per_unit', 'USD', NULL, 1),
      (act_id, '15 minutes (5 rounds)', 16000, 'per_unit', 'USD', NULL, 2);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'kayak';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, 'Single kayak', 1000, 'per_hour', 'USD', NULL, 0),
      (act_id, 'Double kayak', 1500, 'per_hour', 'USD', NULL, 1),
      (act_id, 'Transparent double kayak', 3000, 'per_hour', 'USD', NULL, 2);
  END IF;

  SELECT id INTO act_id FROM public.activities WHERE slug = 'spatium-bike';
  IF act_id IS NOT NULL THEN
    DELETE FROM public.activity_pricing WHERE activity_id = act_id;
    INSERT INTO public.activity_pricing (activity_id, label, price_cents, pricing_unit, currency, note, sort_order) VALUES
      (act_id, 'Children (1 hour)', 2000, 'per_unit', 'USD', NULL, 0),
      (act_id, 'Single adult (1 hour)', 3000, 'per_unit', 'USD', NULL, 1),
      (act_id, 'Double adult (1 hour)', 4000, 'per_unit', 'USD', NULL, 2);
  END IF;
END $$;

-- A D D - O N   P A C K A G E S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Drone Video Shoot', 'drone-video-shoot', 'add-ons',
   'Capture breathtaking aerial footage of your trip with a professional drone video shoot. Great for couples, groups and special occasions.',
   'Aerial drone footage of your trip.',
   'Thoddoo', 3000, '/ shoot', 'USD', '/images/thoddoo/fun-ride.jpg', false, true),

  ('GoPro Rental', 'gopro-rental', 'add-ons',
   'Rent a GoPro for the day to capture your own underwater adventures. Per day, for personal use.',
   'GoPro rental — $20 per day.',
   'Thoddoo', 2000, '/ day', 'USD', '/images/thoddoo/fun-ride.jpg', true, true)
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
  active = EXCLUDED.active;

-- S N O R K E L I N G   T R I P S   ( R a s d h o o   A t o l l )
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Turtle Reef Snorkeling', 'turtle-reef-snorkeling', 'snorkeling',
   'Explore reef sites around Ari Atoll where sea turtles are frequently seen. Sightings depend on natural conditions.',
   'Snorkel over vibrant reefs where turtles are commonly spotted.',
   'Ari Atoll', 7000, '/ person', 'USD', '/images/thoddoo/reef-snorkeling.jpg', false, true),

  ('Manta Snorkeling', 'manta-ray-snorkeling', 'snorkeling',
   'Swim with manta rays at the cleaning stations around Ari Atoll with our experienced guides. Sightings depend on natural conditions.',
   'Snorkel with majestic manta rays around Ari Atoll.',
   'Ari Atoll', 8500, '/ person', 'USD', '/images/thoddoo/manta-snorkeling.jpg', true, true),

  ('One Spot Snorkeling', 'one-spot-snorkeling', 'snorkeling',
   'A single snorkeling spot around Ari Atoll — quick and easy.',
   'One snorkeling spot, one great swim.',
   'Ari Atoll', 3500, '/ person', 'USD', '/images/thoddoo/reef-snorkeling.jpg', false, true),

  ('Two Spot Snorkeling', 'two-spot-snorkeling', 'snorkeling',
   'Visit two of Ari Atoll''s best snorkeling spots in one trip.',
   'Two snorkeling spots in one outing.',
   'Ari Atoll', 7500, '/ person', 'USD', '/images/thoddoo/reef-snorkeling.jpg', false, true),

  ('Three Spot Snorkeling', 'three-spot-snorkeling', 'snorkeling',
   'Three snorkeling spots across the atoll — the full Thoddoo reef experience.',
   'Three snorkeling spots — the full reef experience.',
   'Ari Atoll', 8500, '/ person', 'USD', '/images/thoddoo/reef-snorkeling.jpg', false, true),

  ('Table Coral Garden Snorkeling', 'table-coral-garden-snorkeling', 'snorkeling',
   'Snorkel over large table coral gardens at one of Ari Atoll''s most colorful reef sites.',
   'Colorful table coral gardens snorkel.',
   'Ari Atoll', 8500, '/ person', 'USD', '/images/thoddoo/reef-snorkeling.jpg', false, true)
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
  active = EXCLUDED.active;

-- N U R S E   S H A R K   A D V E N T U R E S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Nurse Shark Trip', 'nurse-shark-adventure', 'snorkeling',
   'Encounter nurse sharks up close at Gangehi Reef in clear, shallow water. Sightings depend on natural conditions.',
   'Encounter nurse sharks at Gangehi Reef.',
   'Gangehi Reef', 8000, '/ person', 'USD', '/images/thoddoo/shark-feeding.jpg', true, true),

  ('Manta & Nurse Shark Combo', 'manta-nurse-shark-combo', 'snorkeling',
   'Our most popular premium experience — manta rays at Gemburu Reef and nurse sharks at Gangehi Reef in one trip.',
   'The ultimate combo — manta rays and nurse sharks in one trip.',
   'Gemburu & Gangehi Reef', 12000, '/ person', 'USD', '/images/thoddoo/half-day-trip.jpg', true, true)
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
  active = EXCLUDED.active;

-- T R I P S   &   E X C U R S I O N S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Sandbank Trip', 'sandbank-trip', 'excursions',
   'Visit a stunning tropical sandbank in the heart of Ari Atoll. Perfect for photos, relaxation and a dip in crystal-clear water.',
   'Escape to a pristine sandbank in turquoise water.',
   'Ari Atoll', 2000, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Fish Feeding @ Blue Hole', 'fish-feeding-blue-hole', 'excursions',
   'Watch and join a fish feeding session at Thoddoo''s famous Blue Hole.',
   'Fish feeding fun at the Blue Hole.',
   'Blue Hole, Thoddoo', 2500, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Madivaru Trip', 'madivaru-trip', 'excursions',
   'A day trip to Madivaru — quiet beaches and a relaxed island escape.',
   'Relaxed day trip to Madivaru.',
   'Madivaru', 2000, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true)
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
  active = EXCLUDED.active;

-- L O C A L   I S L A N D   T R I P S   (min 4 pax)
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Half Day Visit to Ukulhas', 'ukulhas-half-day', 'island-trips',
   'A half-day visit to the local island of Ukulhas. Minimum 4 pax. Per person.',
   'Half-day local island visit to Ukulhas (min 4 pax).',
   'Ukulhas', 7500, '/ person (min 4)', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Half Day Visit to Thoddoo', 'thoddoo-half-day', 'island-trips',
   'A half-day visit to the local island of Thoddoo. Minimum 4 pax. Per person.',
   'Half-day local island visit to Thoddoo (min 4 pax).',
   'Thoddoo', 7500, '/ person (min 4)', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true)
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
  active = EXCLUDED.active;

-- C R U I S E S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Sunset Cruise', 'sunset-cruise', 'cruises',
   'A relaxing evening cruise to enjoy the Maldives sunset over the atoll.',
   'Watch the sunset over the ocean.',
   'Ari Atoll', 3500, '/ person', 'USD', '/images/thoddoo/sunset-fishing.jpg', false, true),

  ('Dolphin Cruise', 'dolphin-cruise', 'cruises',
   'Spot pods of dolphins as they swim and play around Ari Atoll. Sightings depend on natural conditions.',
   'Cruise the atoll and watch dolphins play.',
   'Ari Atoll', 4500, '/ person', 'USD', '/images/thoddoo/sunset-fishing.jpg', false, true)
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
  active = EXCLUDED.active;

-- F I S H I N G
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Sunrise Fishing', 'sunrise-fishing', 'fishing',
   'Early morning fishing trip around Ari Atoll.',
   'Sunrise fishing trip.',
   'Ari Atoll', 8500, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Sunset Fishing', 'sunset-fishing', 'fishing',
   'Evening fishing trip as the sun sets over the atoll.',
   'Sunset fishing trip.',
   'Ari Atoll', 7000, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Night Fishing', 'night-fishing', 'fishing',
   'Night fishing under the stars around Ari Atoll.',
   'Night fishing under the stars.',
   'Ari Atoll', 8500, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Beach BBQ Dinner (after fishing)', 'fishing-bbq-dinner', 'fishing',
   'Fresh BBQ dinner on the beach after your fishing trip. Per person.',
   'Beach BBQ dinner after a fishing trip.',
   'Thoddoo beach', 3000, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true)
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
  active = EXCLUDED.active;

-- R E S O R T   T R I P   (min 4 pax)
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Tropical Paradise Day Retreat', 'tropical-paradise-retreat', 'resort-trips',
   'Full-day retreat to a luxury resort — the tropical paradise experience. Minimum 4 pax. Per person.',
   'Full-day tropical paradise resort retreat (min 4 pax).',
   'Resort, Ari Atoll', 18000, '/ person (min 4)', 'USD', '/images/thoddoo/fun-ride.jpg', false, true)
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
  active = EXCLUDED.active;

-- S P O R T S   F I S H I N G   (boat charter, per boat)
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Sports Fishing (Half Day)', 'sports-fishing-half-day', 'charters',
   'Big game sport fishing on a private boat — trolling, jigging and casting. Half-day charter. Per boat.',
   'Big game sport fishing — half day boat charter.',
   'Ari Atoll', 40000, '/ boat (half day)', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true)
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
  active = EXCLUDED.active;

-- D I N I N G   E X P E R I E N C E S
INSERT INTO public.activities
  (name, slug, category, description, short_description, location,
   base_price_cents, price_note, currency, image, gopro, active)
VALUES
  ('Beach Sunset Dinner', 'beach-sunset-dinner', 'dining',
   'A private beach dinner at sunset — a magical evening on the sand.',
   'Private beach dinner at sunset.',
   'Thoddoo beach', 7500, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Romantic Dinner', 'romantic-dinner', 'dining',
   'An intimate candle-lit dinner set on the beach, tailored for couples.',
   'A romantic candle-lit dinner for two.',
   'Thoddoo beach', 8500, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Beach BBQ Dinner', 'beach-bbq-dinner', 'dining',
   'A full BBQ dinner served on the beach. Grilled fresh catch and island favorites.',
   'Full beach BBQ dinner experience.',
   'Thoddoo beach', 7000, '/ person', 'USD', '/images/thoddoo/sandbank-trip.jpg', false, true)
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
  active = EXCLUDED.active;
