-- =============================================
-- Thoddoo Marine Excursion – Seed Migration 003
-- The centre's activity catalogue, taken from the published rate card.
-- Fully repeatable (ON CONFLICT upsert by slug)
-- =============================================

-- SNORKELLING & ENCOUNTERS
INSERT INTO activities (name, slug, category, description, short_description, location, duration_minutes, base_price_cents, image, gopro, active) VALUES
  ('Turtle Snorkeling', 'turtle-snorkeling', 'snorkeling',
   'Snorkel with sea turtles in the shallows straight from the beach. A short in-shore session, ideal for first timers and families, and a GoPro video of the swim is included.',
   'Snorkel with turtles in the shallows — in-shore, easy, GoPro video included.',
   'Thoddoo shore reef', 60, 2000, '/images/thoddoo/turtle-snorkeling.jpg', true, true),

  ('Reef Snorkeling', 'reef-snorkeling', 'snorkeling',
   'Snorkel the coral reefs around Thoddoo with the crew guiding you over the reef edge. A GoPro video of the session is included.',
   'Guided reef snorkel just off Thoddoo, with GoPro video included.',
   'Near Thoddoo', 60, 3500, '/images/thoddoo/reef-snorkeling.jpg', true, true),

  ('Manta Snorkeling', 'manta-snorkeling', 'snorkeling',
   'Boat out to the cleaning stations near Thoddoo and snorkel with manta rays. Sightings depend on natural conditions and cannot be guaranteed, but the crew knows these waters. GoPro video included.',
   'Snorkel with manta rays at the cleaning stations near Thoddoo.',
   'Near Thoddoo', 120, 4000, '/images/thoddoo/manta-snorkeling.jpg', true, true),

  ('Shark Feeding', 'shark-feeding', 'snorkeling',
   'Watch the reef sharks feed at Rasdhoo, followed by a tour of Rasdhoo itself. Minimum 8 persons for the trip to run.',
   'Reef shark feeding at Rasdhoo plus a tour of the island. Min. 8 persons.',
   'Rasdhoo', 180, 5000, '/images/thoddoo/shark-feeding.jpg', false, true),

  ('Whale Shark Trip', 'whale-shark-trip', 'snorkeling',
   'Full trip to Dhigurah or Mahibadhoo in search of whale sharks, with snorkelling at wherever they are found that day. Minimum 12 persons; sightings depend on natural conditions.',
   'Whale shark snorkeling at Dhigurah or Mahibadhoo. Min. 12 persons.',
   'Dhigurah / Mahibadhoo', 300, 15000, '/images/thoddoo/whale-shark-trip.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_cents = EXCLUDED.base_price_cents,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active;

-- ISLAND & BOAT TRIPS
INSERT INTO activities (name, slug, category, description, short_description, location, duration_minutes, base_price_cents, image, gopro, active) VALUES
  ('Island Hopping', 'island-hopping', 'excursions',
   'Three hours visiting one island of your choice — Rasdhoo, Mathiveri or Ukulhas. Minimum 8 persons for the trip to run.',
   'Three-hour visit to Rasdhoo, Mathiveri or Ukulhas. Min. 8 persons.',
   'Rasdhoo / Mathiveri / Ukulhas', 180, 6500, '/images/thoddoo/island-hopping.jpg', false, true),

  ('Dolphin Cruise', 'dolphin-cruise', 'excursions',
   'Evening dolphin cruise from 17:00 to 18:30 with sunset views, soft drinks and fruit on board. Minimum 4 persons. Dolphin sightings depend on natural conditions.',
   'Sunset dolphin cruise with soft drinks and fruit. Min. 4 persons.',
   'Ari Atoll', 90, 6500, '/images/thoddoo/dolphin-cruise.jpg', false, true),

  ('Half Day Trip', 'half-day-trip', 'excursions',
   'A half-day combination of manta snorkeling, shark snorkeling and a sandbank stop. Minimum 8 persons for the trip to run.',
   'Manta snorkeling, shark snorkeling and a sandbank in one half day. Min. 8 persons.',
   'Ari Atoll', 240, 6500, '/images/thoddoo/half-day-trip.jpg', false, true),

  ('Full Day Trip', 'full-day-trip', 'excursions',
   'A full day of manta snorkeling, shark snorkeling and a shipwreck dive, with lunch at Ukulhas. Minimum 8 persons for the trip to run.',
   'Manta, shark and shipwreck snorkeling with lunch at Ukulhas. Min. 8 persons.',
   'Ukulhas, Ari Atoll', 480, 9500, '/images/thoddoo/full-day-trip.jpg', false, true),

  ('Resort Trip', 'resort-trip', 'resort-trips',
   'Day visit to a resort — choose Ellaidhoo Maldives (all inclusive), Nika Island Resort (lunch only, drinks not included) or Gangehi (all inclusive). Minimum 10 persons for the trip to run.',
   'Resort day visit: Ellaidhoo, Nika Island or Gangehi. Min. 10 persons.',
   'Ellaidhoo / Nika / Gangehi', 480, 15000, '/images/thoddoo/resort-trip.jpg', false, true),

  ('Sand Bank Trip', 'sandbank-trip', 'excursions',
   'Sandbank tour with fish feeding and a Rasdhoo tour. Minimum 10 persons for the trip to run.',
   'Sandbank, fish feeding and a Rasdhoo tour. Min. 10 persons.',
   'Ari Atoll', 240, 6500, '/images/thoddoo/sandbank-trip.jpg', false, true),

  ('Fun Ride', 'fun-ride', 'excursions',
   'A fast ride around Thoddoo followed by 15 minutes of reef snorkeling. The quick way to see the island and get in the water.',
   'Speedboat ride around Thoddoo plus 15 minutes of reef snorkeling.',
   'Thoddoo Lagoon', 60, 3500, '/images/thoddoo/fun-ride.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_cents = EXCLUDED.base_price_cents,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active;

-- FISHING
INSERT INTO activities (name, slug, category, description, short_description, location, duration_minutes, base_price_cents, image, gopro, active) VALUES
  ('Sunset Fishing', 'sunset-fishing', 'fishing',
   'Two hours of night fishing after sunset. Add a beach BBQ afterwards for 15 USD per person.',
   'Two hours of night fishing after sunset; BBQ add-on available.',
   'Ari Atoll', 120, 3500, '/images/thoddoo/sunset-fishing.jpg', false, true),

  ('Octopus Hunting', 'octopus-hunting', 'fishing',
   'Join the crew on a traditional octopus hunt around the reef — wade and free-dive with speargun in hand, then see what the reef gives up.',
   'Traditional octopus hunt around the reef with the local crew.',
   'Near Thoddoo', 120, 4500, '/images/thoddoo/octopus-hunting.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_cents = EXCLUDED.base_price_cents,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active;

-- DINING & PHOTO EXPERIENCES
INSERT INTO activities (name, slug, category, description, short_description, location, duration_minutes, base_price_cents, image, gopro, active) VALUES
  ('Beach Candle Lit Dinner', 'beach-candle-lit-dinner', 'dining',
   'Beach dinner with decoration and music, served 18:30–19:30 on the sand at Thoddoo.',
   'Decorated beach dinner with music, 18:30–19:30.',
   'Thoddoo beach', 60, 15000, '/images/thoddoo/beach-candle-lit-dinner.jpg', false, true),

  ('Romantic Floating Dinner', 'romantic-floating-dinner', 'dining',
   'A floating dinner on the lagoon at sunset, with mocktails. Set on the water for two.',
   'Floating sunset dinner on the lagoon with mocktails.',
   'Thoddoo lagoon', 90, 15000, '/images/thoddoo/romantic-floating-dinner.jpg', false, true),

  ('Drone Photo Shoot', 'drone-photo-shoot', 'add-ons',
   'A drone photo and video session at a location or with a theme of your choice around Thoddoo.',
   'Drone photos and video at a location or theme of your choice.',
   'Thoddoo', 45, 4000, '/images/thoddoo/drone-photo-shoot.jpg', false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  location = EXCLUDED.location,
  duration_minutes = EXCLUDED.duration_minutes,
  base_price_cents = EXCLUDED.base_price_cents,
  image = EXCLUDED.image,
  gopro = EXCLUDED.gopro,
  active = EXCLUDED.active;
