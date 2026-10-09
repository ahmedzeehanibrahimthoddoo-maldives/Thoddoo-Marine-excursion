-- 018_cms.sql
-- Content management tables for the public website (site settings, gallery,
-- explore/Thoddoo experiences page) plus CMS columns on activities.
-- Owner/manager can write; everybody (including anon) can read.

begin;

-- =============================================
-- Site content (simple key/value settings + long copy)
-- =============================================
create table if not exists public.site_content (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

-- =============================================
-- Gallery images
-- =============================================
create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  caption text not null default '',
  orientation text not null default 'landscape',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The excursion each photo shows (added here so the seed below can set it;
-- 074 keeps an IF NOT EXISTS guard for older databases)
alter table public.gallery_items add column if not exists tag text;

-- =============================================
-- Explore / "Thoddoo Experiences" items
-- =============================================
create table if not exists public.explore_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text not null default '',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================
-- Activities: CMS-driven hero image + featured flag
-- =============================================
alter table public.activities add column if not exists hero_image_url text;
alter table public.activities add column if not exists featured boolean not null default false;

-- =============================================
-- RLS
-- =============================================
alter table public.site_content enable row level security;
alter table public.gallery_items enable row level security;
alter table public.explore_items enable row level security;

drop policy if exists "content_read_public" on public.site_content;
create policy "content_read_public" on public.site_content
  for select using (true);

drop policy if exists "content_write_admin" on public.site_content;
create policy "content_write_admin" on public.site_content
  for all to authenticated
  using (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ))
  with check (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ));

drop policy if exists "gallery_read_public" on public.gallery_items;
create policy "gallery_read_public" on public.gallery_items
  for select using (true);

drop policy if exists "gallery_write_admin" on public.gallery_items;
create policy "gallery_write_admin" on public.gallery_items
  for all to authenticated
  using (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ))
  with check (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ));

drop policy if exists "explore_read_public" on public.explore_items;
create policy "explore_read_public" on public.explore_items
  for select using (true);

drop policy if exists "explore_write_admin" on public.explore_items;
create policy "explore_write_admin" on public.explore_items
  for all to authenticated
  using (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ))
  with check (exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
  ));

grant select on public.site_content, public.gallery_items, public.explore_items to anon, authenticated;
grant insert, update, delete on public.site_content, public.gallery_items, public.explore_items to authenticated;

-- =============================================
-- Seeds (only when tables are empty so admin edits are respected)
-- =============================================
insert into public.site_content (key, value)
select * from (values
  ('hero_eyebrow', 'THODDOO • ARI ATOLL'),
  ('hero_title_1', 'YOUR TRIPS.'),
  ('hero_title_2', 'PARTNER.'),
  ('hero_subtitle', 'Snorkel with manta rays, turtles and whale sharks, hop between islands, fish at sunset and dine on the beach — every trip runs from Thoddoo in Ari Atoll.'),
  ('phone_1', '+960 9472110'),
  ('phone_2', '+62 81353748031'),
  ('address_line', 'Anboofannu magu, Thoddoo, Ari Atoll, Maldives'),
  ('explore_p1', 'Thoddoo is a local island in Ari Atoll, Maldives. Known for its clear lagoon, working reef and easy access to the reefs of the whole atoll, it is one of the best bases for ocean adventures in the Maldives.'),
  ('explore_p2', 'From turtle snorkeling off the beach and manta cleaning stations to island hops, sandbank stops, night fishing and beach dinners — Thoddoo offers experiences that are raw, real and unforgettable.'),
  ('explore_p3', 'Life here moves at the pace of the ocean. Mornings on the water, afternoons under the palms, evenings on the beach — all of it a short walk from our jetty on Anboofannu magu.'),
  ('about_p1', 'Thoddoo Marine Excursion is a local crew running trips from Thoddoo, a local island in Ari Atoll, Maldives.'),
  ('about_p2', 'From snorkeling with turtles, mantas and whale sharks to island hopping, resort days, night fishing, fun rides and candle lit dinners — we run trips for couples, families and groups visiting Thoddoo.'),
  ('about_p3', 'Every trip leaves from our jetty, guided by a local crew who fish, swim and dive these reefs every day of the week.')
) as v(key, value)
where not exists (select 1 from public.site_content);

insert into public.gallery_items (image_url, caption, orientation, sort_order, tag)
select * from (values
  ('/images/thoddoo/turtle-snorkeling.jpg', 'Turtle snorkeling off Thoddoo', 'landscape', 1, 'turtle-snorkeling'),
  ('/images/thoddoo/manta-snorkeling.jpg', 'Manta snorkeling near Thoddoo', 'landscape', 2, 'manta-snorkeling'),
  ('/images/thoddoo/reef-snorkeling.jpg', 'Reef snorkeling in Ari Atoll', 'landscape', 3, 'reef-snorkeling'),
  ('/images/thoddoo/whale-shark-trip.jpg', 'Whale shark trip to Dhigurah', 'landscape', 4, 'whale-shark-trip'),
  ('/images/thoddoo/shark-feeding.jpg', 'Shark feeding at Rasdhoo', 'landscape', 5, 'shark-feeding'),
  ('/images/thoddoo/sandbank-trip.jpg', 'Sandbank trip in Ari Atoll', 'landscape', 6, 'sandbank-trip'),
  ('/images/thoddoo/island-hopping.jpg', 'Island hopping from Thoddoo', 'landscape', 7, 'island-hopping'),
  ('/images/thoddoo/dolphin-cruise.jpg', 'Dolphin cruise at sunset', 'landscape', 8, 'dolphin-cruise'),
  ('/images/thoddoo/half-day-trip.jpg', 'Half day trip from Thoddoo', 'landscape', 9, 'half-day-trip'),
  ('/images/thoddoo/full-day-trip.jpg', 'Full day trip with lunch at Ukulhas', 'landscape', 10, 'full-day-trip'),
  ('/images/thoddoo/resort-trip.jpg', 'Resort day visit from Thoddoo', 'landscape', 11, 'resort-trip'),
  ('/images/thoddoo/sunset-fishing.jpg', 'Night fishing after sunset', 'landscape', 12, 'sunset-fishing'),
  ('/images/thoddoo/octopus-hunting.jpg', 'Octopus hunting on the reef', 'landscape', 13, 'octopus-hunting'),
  ('/images/thoddoo/fun-ride.jpg', 'Fun ride around Thoddoo', 'landscape', 14, 'fun-ride'),
  ('/images/thoddoo/beach-candle-lit-dinner.jpg', 'Beach candle lit dinner', 'landscape', 15, 'beach-candle-lit-dinner'),
  ('/images/thoddoo/romantic-floating-dinner.jpg', 'Romantic floating dinner on the lagoon', 'landscape', 16, 'romantic-floating-dinner'),
  ('/images/thoddoo/drone-photo-shoot.jpg', 'Drone photo shoot over Thoddoo', 'landscape', 17, 'drone-photo-shoot')
) as v(image_url, caption, orientation, sort_order, tag)
where not exists (select 1 from public.gallery_items);

insert into public.explore_items (title, body, image_url, sort_order)
select * from (values
  ('Beaches', 'White sand, a calm turquoise lagoon and shaded palms — the whole island is a short walk from the water.', '/images/thoddoo/sandbank-trip.jpg', 1),
  ('Snorkeling', 'Turtles in the shallows, mantas on the cleaning stations and reefs alive with fish, all within reach of Thoddoo.', '/images/thoddoo/turtle-snorkeling.jpg', 2),
  ('Sandbank', 'A picture-perfect sandbank with fish feeding and open ocean on every side.', '/images/thoddoo/sandbank-trip.jpg', 3),
  ('Island Hops', 'Rasdhoo, Mathiveri and Ukulhas are a short boat ride away — pick one and go for the day.', '/images/thoddoo/island-hopping.jpg', 4),
  ('Fishing', 'Cast a line at sunset or head out for two hours of night fishing in Ari Atoll.', '/images/thoddoo/sunset-fishing.jpg', 5),
  ('Sunset Experiences', 'Dolphin cruises at 17:00, candle lit dinners on the sand and the sky turning gold over the lagoon.', '/images/thoddoo/dolphin-cruise.jpg', 6)
) as v(title, body, image_url, sort_order)
where not exists (select 1 from public.explore_items);

commit;