-- =============================================
-- 026: FIX generate_signing_token search_path
-- =============================================
-- submit_checkin_consent (and any consent_forms /
-- equipment_rentals INSERT from a SECURITY DEFINER
-- function with search_path=public) failed calling
-- gen_random_bytes() because it was unqualified and
-- 'extensions' was not on the search_path.
-- Schema-qualify the call so it works from any caller.
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_signing_token()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT encode(extensions.gen_random_bytes(32), 'hex');
$$;

COMMIT;