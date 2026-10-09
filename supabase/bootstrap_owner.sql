-- =============================================
-- Thoddoo Marine CMS – Owner Bootstrap
-- Run ONCE in Supabase SQL Editor after migrations.
-- Looks up ahmedthoddoo@gmail.com in auth.users,
-- inserts the owner row into staff_profiles.
-- Safe: fails if 0 or >1 matching users, idempotent on staff_profiles.
-- =============================================

DO $$
DECLARE
  v_user_id UUID;
  v_count   INT;
BEGIN
  -- 1. Find auth.users row for the initial owner
  SELECT count(*) INTO v_count FROM auth.users WHERE email = 'ahmedthoddoo@gmail.com';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No auth.users row with email ahmedthoddoo@gmail.com. Sign up / create that user in Supabase Auth first.';
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'Multiple auth.users rows with email ahmedthoddoo@gmail.com. Resolve duplicates first.';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = 'ahmedthoddoo@gmail.com' LIMIT 1;

  -- 2. Upsert staff_profiles row (idempotent)
  INSERT INTO staff_profiles (user_id, full_name, role, active)
  VALUES (v_user_id, 'Ahmed', 'owner', true)
  ON CONFLICT (user_id) DO UPDATE SET
    role    = EXCLUDED.role,
    active  = EXCLUDED.active,
    full_name = EXCLUDED.full_name;

  RAISE NOTICE 'Owner profile created/updated for user %', v_user_id;
END $$;
