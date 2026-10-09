-- 021_staff_login_search_path.sql
-- create_staff_login must also resolve crypt/gen_salt from the extensions schema.

begin;

CREATE OR REPLACE FUNCTION public.create_staff_login(p_email TEXT, p_password TEXT, p_full_name TEXT, p_role TEXT, p_phone TEXT DEFAULT NULL) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE v_caller_role TEXT; v_user_id UUID; v_staff_id UUID;
BEGIN
  SELECT role INTO v_caller_role FROM public.staff_profiles WHERE user_id = auth.uid() AND active = true;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_email IS NULL OR length(trim(p_email)) < 5 THEN RAISE EXCEPTION 'A valid email is required.'; END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters.'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN RAISE EXCEPTION 'A user with this email already exists.'; END IF;
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, aud, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (gen_random_uuid(), lower(trim(p_email)), crypt(p_password, gen_salt('bf')), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('provider','email','providers',array['email']), jsonb_build_object('full_name', p_full_name), now(), now())
  RETURNING id INTO v_user_id;
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES (v_user_id, v_user_id, v_user_id::text, 'email', jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email))), now(), now(), now());
  INSERT INTO public.staff_profiles (user_id, full_name, role, phone, active) VALUES (v_user_id, p_full_name, p_role::staff_role, p_phone, true) RETURNING id INTO v_staff_id;
  RETURN json_build_object('success', true, 'staff_id', v_staff_id, 'user_id', v_user_id, 'email', lower(trim(p_email)));
END $$;

REVOKE ALL ON FUNCTION public.create_staff_login(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_staff_login(text,text,text,text,text) TO authenticated;

commit;