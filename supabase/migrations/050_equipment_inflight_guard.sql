-- ================================================================
-- 050 — Equipment double-checkout guard
-- ================================================================
-- WHY: The reception/rentals flow lets a staff member check out any
-- "active" equipment item (lib/supabase/actions.ts:checkoutEquipment
-- filters only equipment.active = true). Two staff members checking
-- out the SAME physical item for two different customers at (nearly)
-- the same moment currently both succeed: there is no constraint and
-- no pre-check preventing an item from having two simultaneous
-- in-flight rentals.
--
-- equipment_rentals.status (rental_status enum, migration 001) has
-- exactly THREE values: 'checked_out', 'returned', 'overdue'.
-- Only 'checked_out' and 'overdue' are IN-FLIGHT (item physically
-- away from the shop). 'returned' means the item is physically back.
--
-- So the correct partial-unique predicate is:
--
--   WHERE status IN ('checked_out', 'overdue')
--
-- NOT "returned_at IS NULL" alone (a pre-seeded/historical row with
-- status='returned' but a NULL returned_at would block re-rental),
-- and NOT "all non-returned" (cancelled/void rows do not exist in
-- this enum — but if they ever are added, the explicit IN() keeps
-- them OUT of the in-flight guard).
--
-- A partial unique index on equipment_id WHERE status IS IN-FLIGHT
-- is the authoritative concurrency guard:
--   * The DB serializes the insert/update; two concurrent inserts of
--     the SAME equipment_id in an in-flight status → second one fails
--     with a unique_violation (internal-equipmentrental...).
--   * 'returned' rows are excluded → returning frees the item for a
--     future checkout (normal re-rental works).
--   * Each physical item can be in exactly one in-flight rental at a
--     time, enforced atomically — no app-level check can race it.
-- ================================================================

-- Guard: one in-flight rental per physical equipment item.
-- NULL equipment_id rows are impossible (equipment_id NOT NULL), and
-- the partial predicate doesn't reference nullable columns, so this
-- index can never reject a legitimate row — only the duplicate case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_rentals_one_inflight
  ON public.equipment_rentals (equipment_id)
  WHERE status IN ('checked_out', 'overdue');

-- Note: created with IF NOT EXISTS so re-running a stale migration is
-- harmless; the predicate itself is immutable on this schema.
