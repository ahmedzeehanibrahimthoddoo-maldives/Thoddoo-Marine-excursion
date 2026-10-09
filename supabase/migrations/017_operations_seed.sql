-- =============================================
-- Thoddoo Marine – Operations Seed Migration 017
-- Starter fleet + crew roster for the operations module.
-- NOTE: placeholder starter data — replace names/phones with the
-- real list, or run your live stats via the admin once this lands.
-- Fully repeatable (ON CONFLICT for all inserts).
-- =============================================

-- =============================================
-- 1. BOATS / CRAFT
-- =============================================
INSERT INTO boats (name, boat_type, capacity_pax, status, notes) VALUES
  ('Thoddoo Marine Speedboat',   'speedboat', 12, 'active',     'Excursions, transfers, dolphin & sunset cruises.'),
  ('Thoddoo Marine Dhoni',       'dhoni',      8, 'active',     'Snorkeling, diving and reef trips.'),
  ('Sunset Cruise Dhoni',      'dhoni',     10, 'active',     'Sunset cruise – evening runs.'),
  ('Towing RIB',               'rib',        4, 'active',     'Funtube, banana, water skiing and wakeboarding tow boat.'),
  ('Jet Ski 1',                'jet_ski',    1, 'active',     'Thoddoo Lagoon session craft.'),
  ('Jet Ski 2',                'jet_ski',    1, 'active',     'Thoddoo Lagoon session craft.'),
  ('Kayak – Single',           'kayak',      1, 'active',     'Lagoon paddle.'),
  ('Kayak – Double',           'kayak',      2, 'active',     'Lagoon paddle.'),
  ('Transparent Kayak',        'kayak',      2, 'active',     'Glass-bottom lagoon paddle.'),
  ('SUP Board 1',              'sup',        1, 'active',     'Stand-up paddleboard.'),
  ('SUP Board 2',              'sup',        1, 'active',     'Stand-up paddleboard.'),
  ('SUP + Scooter',            'sup',        2, 'active',     'SUP equipped with underwater scooter.')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 2. OPERATIONAL CREW ROSTER
-- =============================================
INSERT INTO crew_members (full_name, role, phone, active, notes) VALUES
  ('Ahmed',    'Boat Captain',     '+960 7770001', true,  'Owner / captain. Thoddoo native, knows the atoll reefs.'),
  ('Adam',     'Dive Instructor',  '+960 7770002', true,  'PADI instructor – diving, manta & nurse shark trips.'),
  ('Mohamed',  'Boat Captain',     '+960 7770003', true,  'Speedboat & dhoni captain.'),
  ('Hussain',  'Snorkel Guide',    '+960 7770004', true,  'Snorkeling guide for reef trips.'),
  ('Ibrahim',  'Jet Ski Operator', '+960 7770005', true,  'Jet ski / towing operator.'),
  ('Ismail',   'Deck Hand',        '+960 7770006', true,  'General boat crew, transfers.'),
  ('Thoyyib',  'Engineer',         '+960 7770007', true,  'Fleet maintenance – jet skis & outboards.'),
  ('Mariyam',  'Reception / Guide','+960 7770008', true,  'Check-in, consents and guest coordination.')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 3. GEAR CATALOG (existing equipment table)
-- Item-based to keep rental/consent flows intact.
-- ON CONFLICT (asset_number) DO NOTHING so any live inventory survives.
-- =============================================
INSERT INTO equipment (name, asset_number, category, description, condition_status, daily_rate_cents, deposit_cents, active) VALUES
  ('Snorkel Set (mask + snorkel)',    'SNK-001', 'diving', 'Adult snorkel set – divided by size.',        'good', 0, 0, true),
  ('Snorkel Set (mask + snorkel)',    'SNK-002', 'diving', 'Adult snorkel set – divided by size.',        'good', 0, 0, true),
  ('Snorkel Set (mask + snorkel)',    'SNK-003', 'diving', 'Adult snorkel set – divided by size.',        'good', 0, 0, true),
  ('Snorkel Set (mask + snorkel)',    'SNK-004', 'diving', 'Adult snorkel set – divided by size.',        'good', 0, 0, true),
  ('Snorkel Set (mask + snorkel)',    'SNK-005', 'diving', 'Adult snorkel set – divided by size.',        'fair', 0, 0, true),
  ('Adult Life Jacket',               'LJ-001',  'safety', 'Coastguard-style buoyancy aid.',               'good', 0, 0, true),
  ('Adult Life Jacket',               'LJ-002',  'safety', 'Coastguard-style buoyancy aid.',               'good', 0, 0, true),
  ('Adult Life Jacket',               'LJ-003',  'safety', 'Coastguard-style buoyancy aid.',               'good', 0, 0, true),
  ('Adult Life Jacket',               'LJ-004',  'safety', 'Coastguard-style buoyancy aid.',               'good', 0, 0, true),
  ('Child Life Jacket',               'LJC-001', 'safety', 'Child size buoyancy aid.',                     'good', 0, 0, true),
  ('Child Life Jacket',               'LJC-002', 'safety', 'Child size buoyancy aid.',                     'good', 0, 0, true),
  ('Fins (Adult)',                    'FIN-001', 'diving', 'Open-heel snorkeling fins.',                   'good', 0, 0, true),
  ('Fins (Adult)',                    'FIN-002', 'diving', 'Open-heel snorkeling fins.',                   'good', 0, 0, true),
  ('Fins (Adult)',                    'FIN-003', 'diving', 'Open-heel snorkeling fins.',                   'fair', 0, 0, true),
  ('Dive Tank + Regulator',           'TNK-101', 'diving', '12L aluminum tank with regulator set.',        'good', 0, 0, true),
  ('Dive Tank + Regulator',           'TNK-102', 'diving', '12L aluminum tank with regulator set.',        'good', 0, 0, true),
  ('Dive Tank + Regulator',           'TNK-103', 'diving', '12L aluminum tank with regulator set.',        'good', 0, 0, true),
  ('Dive Tank + Regulator',           'TNK-104', 'diving', '12L aluminum tank with regulator set.',        'fair', 0, 0, false)
ON CONFLICT (asset_number) DO NOTHING;

-- =============================================
-- 4. STARTER TRIPS (NEXT FEW DAYS, MVD TIME)
-- Gives the operations board something to show immediately.
-- Deterministic dates offset from today so re-runs stay useful.
-- ON CONFLICT-free: deletes then re-inserts the starter window.
-- =============================================
DO $$
DECLARE
  v_d0  DATE := (now() AT TIME ZONE 'Indian/Maldives')::DATE;
  v_i   INT;
  v_sb  UUID; v_dhow UUID; v_jet UUID; v_kayak UUID; v_sup UUID; v_tow UUID;
  v_act_snorkel UUID; v_act_sandbank UUID; v_act_sunset UUID; v_act_dolphin UUID;
  v_act_jetski UUID; v_act_kayak UUID; v_act_sup UUID; v_act_turtle UUID; v_act_dive UUID;
  v_adam UUID; v_hussain UUID; v_ibrahim UUID; v_mohamed UUID; v_ismail UUID;
BEGIN
  SELECT id INTO v_sb     FROM boats WHERE name = 'Thoddoo Marine Speedboat';
  SELECT id INTO v_dhow   FROM boats WHERE name = 'Thoddoo Marine Dhoni';
  SELECT id INTO v_jet    FROM boats WHERE name = 'Jet Ski 1';
  SELECT id INTO v_kayak  FROM boats WHERE name = 'Kayak – Double';
  SELECT id INTO v_sup    FROM boats WHERE name = 'SUP Board 1';
  SELECT id INTO v_tow    FROM boats WHERE name = 'Towing RIB';

  SELECT id INTO v_act_snorkel  FROM activities WHERE slug = 'manta-ray-snorkeling';
  SELECT id INTO v_act_turtle   FROM activities WHERE slug = 'turtle-reef-snorkeling';
  SELECT id INTO v_act_dolphin  FROM activities WHERE slug = 'dolphin-cruise';
  SELECT id INTO v_act_sandbank FROM activities WHERE slug = 'sandbank-trip';
  SELECT id INTO v_act_jetski   FROM activities WHERE slug = 'jet-ski';
  SELECT id INTO v_act_kayak    FROM activities WHERE slug = 'kayak';
  SELECT id INTO v_act_sup      FROM activities WHERE slug = 'stand-up-paddleboard';
  SELECT id INTO v_act_dive     FROM activities WHERE slug = 'manta-nurse-shark-combo';

  SELECT id INTO v_adam    FROM crew_members WHERE full_name = 'Adam';
  SELECT id INTO v_hussain FROM crew_members WHERE full_name = 'Hussain';
  SELECT id INTO v_ibrahim FROM crew_members WHERE full_name = 'Ibrahim';
  SELECT id INTO v_mohamed FROM crew_members WHERE full_name = 'Mohamed';
  SELECT id INTO v_ismail  FROM crew_members WHERE full_name = 'Ismail';

  -- Remove any previously seeded starter trips (activity matches only)
  DELETE FROM trips WHERE trip_date BETWEEN v_d0 AND v_d0 + 3
    AND activity_id IN (v_act_snorkel, v_act_turtle, v_act_dolphin, v_act_sandbank, v_act_jetski, v_act_kayak, v_act_sup, v_act_dive);

  -- Today: standard daily runs
  IF v_act_snorkel IS NOT NULL AND v_dhow IS NOT NULL THEN
    INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
    VALUES (v_act_snorkel, v_dhow, v_d0, '09:30', '12:30', v_adam, 8, 8, 'planned', NULL);
  END IF;
  IF v_act_sandbank IS NOT NULL AND v_sb IS NOT NULL THEN
    INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
    VALUES (v_act_sandbank, v_sb, v_d0, '10:00', '12:00', v_ismail, 12, 12, 'planned', NULL);
  END IF;
  IF v_act_dolphin IS NOT NULL AND v_sb IS NOT NULL THEN
    INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
    VALUES (v_act_dolphin, v_sb, v_d0, '16:30', '18:30', v_mohamed, 12, 12, 'planned', NULL);
  END IF;

  -- On-demand watersports sessions over the next days
  IF v_act_jetski IS NOT NULL AND v_jet IS NOT NULL THEN
    FOR v_i IN 0..2 LOOP
      INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
      VALUES (v_act_jetski, v_jet, v_d0 + v_i, '10:00', '10:30', v_ibrahim, 1, 1, 'planned', NULL);
      INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
      VALUES (v_act_jetski, v_jet, v_d0 + v_i, '15:00', '15:30', v_ibrahim, 1, 1, 'planned', NULL);
    END LOOP;
  END IF;
  IF v_act_kayak IS NOT NULL AND v_kayak IS NOT NULL THEN
    INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
    VALUES (v_act_kayak, v_kayak, v_d0, '09:00', '10:00', v_ismail, 2, 2, 'planned', NULL);
  END IF;
  IF v_act_sup IS NOT NULL AND v_sup IS NOT NULL THEN
    INSERT INTO trips (activity_id, boat_id, trip_date, start_time, end_time, guide_id, capacity_pax, seats_open, status, created_by)
    VALUES (v_act_sup, v_sup, v_d0, '11:00', '12:00', v_ismail, 1, 1, 'planned', NULL);
  END IF;

  RAISE NOTICE 'Operations starter trips seeded for window % to %', v_d0::TEXT, (v_d0 + 3)::TEXT;
END $$;