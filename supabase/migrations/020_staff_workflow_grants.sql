-- 020_staff_workflow_grants.sql
-- Lock down the new create_trip / update_trip overloads (with captain_id)
-- to authenticated only, matching the original 016 posture (anon revoked).

begin;

REVOKE ALL ON FUNCTION public.create_trip(UUID, UUID, DATE, TEXT, TEXT, UUID, UUID, INT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_trip(UUID, UUID, DATE, TEXT, TEXT, UUID, UUID, INT, INT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_trip(UUID, UUID, DATE, TEXT, TEXT, UUID, UUID, INT, INT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.update_trip(UUID, UUID, TEXT, TEXT, UUID, UUID, INT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_trip(UUID, UUID, TEXT, TEXT, UUID, UUID, INT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TEXT, TEXT, UUID, UUID, INT, INT, TEXT) TO authenticated;

commit;