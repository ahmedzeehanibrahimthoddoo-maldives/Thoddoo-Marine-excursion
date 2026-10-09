-- 077 — Commission as a percentage OR a fixed amount (USD or MVR)
--
-- The problem this fixes
-- ---------------------
-- Until now a partner's cut was `activities.commission_cents`, one integer, a
-- fixed amount PER GUEST, copied into bookings by a BEFORE INSERT trigger
-- (054/056). Two things were impossible because of that shape:
--
--   1. A percentage deal. "10% of the trip" could not be recorded as a rate, so
--      it had to be flattened to a number — and then it could never be
--      re-derived when the booking total changed.
--   2. A past booking. The trigger is BEFORE INSERT, so fixing a rate on an
--      activity changed every FUTURE booking and nothing that already went out.
--      A missed commission could only be fixed one booking at a time, by hand.
--
-- The shape
-- ---------
-- activities.commission_mode    'fixed' (default, today's behaviour) or 'percent'
-- activities.commission_percent rate, used only when mode = 'percent'
-- bookings.commission_mode      snapshot of the rule that produced the amount
-- bookings.commission_percent   snapshot of the rate (NULL for fixed)
-- bookings.commission_currency  currency the amount is expressed in
--
-- commission_cents keeps its meaning: the resolved partner cut, in the
-- BOOKING's currency. A fixed amount quoted in MVR on a USD booking is
-- converted at the project's fixed 18.0 rate on the way in, so every report
-- that sums commission_cents by booking_currency stays correct.
--
-- Why bookings.commission_mode has NO default
-- -------------------------------------------
-- A DEFAULT would make the column non-NULL before the trigger ever runs, and the
-- trigger's "caller did not state a rule, so inherit from the activity" branch
-- would be dead code — a percent activity would silently apply as fixed. It
-- stays nullable, the trigger fills it, backfill_booking_commission() fills it
-- for existing rows, and lib/commission.ts treats NULL as 'fixed' for rows
-- written before this migration.
--
-- net_cents is NOT touched on update, only by the backfill (and only when it can
-- prove the net was never deliberately set) — see net_was_unset() below.

BEGIN;

-- ============================================================
-- 1. Columns
-- ============================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS commission_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (commission_mode IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(7, 2)
    CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_mode TEXT
    CHECK (commission_mode IS NULL OR commission_mode IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(7, 2)
    CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
  ADD COLUMN IF NOT EXISTS commission_currency TEXT
    CHECK (commission_currency IS NULL OR commission_currency IN ('USD', 'MVR'));

-- The partner/ops reports filter and group by activity, not by rule, but the
-- backfill needs to find rows whose rule was never recorded.
CREATE INDEX IF NOT EXISTS idx_bookings_commission_rule
  ON public.bookings (commission_mode, commission_percent);

COMMENT ON COLUMN public.activities.commission_mode IS
  'How activities.commission_cents is read: fixed per-guest amount (default) or percent of the booking total.';
COMMENT ON COLUMN public.activities.commission_percent IS
  'Rate used when commission_mode = percent. Ignored in fixed mode.';
COMMENT ON COLUMN public.bookings.commission_mode IS
  'Snapshot of the rule that produced commission_cents. NULL means fixed (pre-077 rows).';
COMMENT ON COLUMN public.bookings.commission_percent IS
  'Snapshot of the rate, so a percentage stays recomputable when the total changes.';
COMMENT ON COLUMN public.bookings.commission_currency IS
  'Currency of commission_cents. Always the booking currency once written by this migration.';

-- ============================================================
-- 2. Percent-aware insert trigger (replaces the 056 body)
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_partner_split_bookings()
RETURNS TRIGGER AS $$
DECLARE
  v_pax      INTEGER;
  v_comm     INTEGER;
  v_net      INTEGER;
  v_partner  TEXT;
  v_mode     TEXT;
  v_pct      NUMERIC;
  v_basis    INTEGER;
  v_currency TEXT;
  v_act_ccy  TEXT;
  v_rate     NUMERIC;
BEGIN
  IF NEW.activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.commission_cents, a.net_cents, a.partner, a.commission_mode, a.commission_percent,
         a.currency
    INTO v_comm, v_net, v_partner, v_mode, v_pct, v_act_ccy
    FROM public.activities a
   WHERE a.id = NEW.activity_id;

  IF v_comm IS NULL OR v_net IS NULL THEN
    RETURN NEW;
  END IF;

  -- Partner name (only when not explicitly provided).
  IF NEW.partner IS NULL AND v_partner IS NOT NULL THEN
    NEW.partner := v_partner;
  END IF;

  v_pax := GREATEST(COALESCE(NEW.guests, 0), 0);
  IF v_pax = 0 THEN
    v_pax := GREATEST(COALESCE(NEW.adults, 0), 0)
           + GREATEST(COALESCE(NEW.children_count, 0), 0);
  END IF;

  -- What a percentage is taken of: the sale, not the pax count.
  v_basis := GREATEST(COALESCE(NEW.total_cents, 0), COALESCE(NEW.estimated_total_cents, 0));

  -- Commission is always recorded in the booking's own currency, converted with
  -- the rate the booking snapshotted (008), so reports can sum by
  -- booking_currency without knowing which currency the rate was quoted in.
  v_currency := COALESCE(NEW.booking_currency, 'USD');
  v_act_ccy := COALESCE(v_act_ccy, 'USD');
  v_rate := COALESCE(NEW.exchange_rate_mvr_per_usd, 18);

  -- Snapshot the rule, but only when the caller did not state one.
  IF NEW.commission_mode IS NULL THEN
    NEW.commission_mode := COALESCE(v_mode, 'fixed');
  END IF;
  IF NEW.commission_percent IS NULL THEN
    NEW.commission_percent := v_pct;
  END IF;
  IF NEW.commission_currency IS NULL THEN
    NEW.commission_currency := v_currency;
  END IF;

  IF NEW.commission_mode = 'percent' AND COALESCE(v_pct, 0) > 0 THEN
    IF v_basis > 0 AND (NEW.commission_cents IS NULL OR NEW.commission_cents = 0) THEN
      NEW.commission_cents := ROUND(v_basis * v_pct / 100.0);
    END IF;
    -- Operator's take is the sale minus the partner's cut. Only overwrite a net
    -- that still equals the sale, i.e. one nobody set by hand.
    IF NEW.net_cents IS NULL OR NEW.net_cents = 0 OR NEW.net_cents = v_basis THEN
      NEW.net_cents := GREATEST(v_basis - NEW.commission_cents, 0);
    END IF;
  ELSIF v_comm > 0 OR v_net > 0 THEN
    -- Fixed amount, per guest (the 054/056 behaviour).
    IF v_pax > 0 THEN
      IF NEW.commission_cents IS NULL OR NEW.commission_cents = 0 THEN
        NEW.commission_cents := CASE
          WHEN v_act_ccy = v_currency THEN v_comm * v_pax
          WHEN v_act_ccy = 'MVR'   THEN ROUND((v_comm * v_pax) / v_rate)
          ELSE ROUND((v_comm * v_pax) * v_rate)
        END;
      END IF;
      IF NEW.net_cents IS NULL OR NEW.net_cents = 0 THEN
        NEW.net_cents := CASE
          WHEN v_act_ccy = v_currency THEN v_net * v_pax
          WHEN v_act_ccy = 'MVR'   THEN ROUND((v_net * v_pax) / v_rate)
          ELSE ROUND((v_net * v_pax) * v_rate)
        END;
      END IF;
    END IF;
  ELSE
    -- No partner split: keep the full guest amount.
    IF (NEW.commission_cents IS NULL OR NEW.commission_cents = 0)
       AND (NEW.net_cents IS NULL OR NEW.net_cents = 0) THEN
      NEW.net_cents := v_basis;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Re-attached so an existing database picks up the new body (DROP/CREATE would
-- drop the trigger with its function).
DROP TRIGGER IF EXISTS trg_bookings_auto_partner_split ON public.bookings;
CREATE TRIGGER trg_bookings_auto_partner_split
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.auto_partner_split_bookings();

-- ============================================================
-- 3. Backfill RPC — the answer to "I can't add commission to a past booking"
-- ============================================================

-- Would a stored net be rewritten? Only when it still equals the sale, which is
-- exactly what 056 leaves behind when an activity has no partner split. Kept in
-- its own function so the RPC and lib/commission.ts state the same rule.
CREATE OR REPLACE FUNCTION public.net_was_unset(p_net_cents INTEGER, p_basis_cents INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_basis_cents > 0 AND COALESCE(p_net_cents, 0) = p_basis_cents;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.backfill_booking_commission(
  p_from  DATE,
  p_to    DATE,
  p_apply BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
  v_role      staff_role;
  v_row       RECORD;
  v_comm_mode TEXT;
  v_pct       NUMERIC;
  v_fixed     INTEGER;
  v_basis     INTEGER;
  v_currency  TEXT;
  v_rate      NUMERIC;
  v_pax       INTEGER;
  v_new_comm  INTEGER;
  v_new_net   INTEGER;
  v_net_touch BOOLEAN;
  v_changed   INTEGER := 0;
  v_nets      INTEGER := 0;
  v_skipped   INTEGER := 0;
  v_old_sum   BIGINT := 0;
  v_new_sum   BIGINT := 0;
  v_samples   JSONB := '[]'::jsonb;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Staff authentication required.');
  END IF;
  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RETURN json_build_object('error', 'forbidden', 'message', 'Only owners, managers and reception can backfill commission.');
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN json_build_object('error', 'validation', 'message', 'Choose a valid date range.');
  END IF;

  FOR v_row IN
    SELECT b.id, b.booking_ref, b.booking_date, b.status, b.guests, b.adults, b.children_count,
           b.total_cents, b.estimated_total_cents, b.net_cents, b.commission_cents,
           b.booking_currency, b.exchange_rate_mvr_per_usd,
           a.commission_mode AS activity_mode,
           a.commission_percent AS activity_percent,
           a.commission_cents AS activity_fixed,
           a.currency AS activity_currency
      FROM public.bookings b
      JOIN public.activities a ON a.id = b.activity_id
     WHERE b.booking_date BETWEEN p_from AND p_to
       AND b.status <> 'cancelled'
     ORDER BY b.booking_date, b.booking_ref
  LOOP
    -- A no-show still cost the partner's time, so it is NOT skipped; only a
    -- cancelled booking has no sale to take a cut from.
    v_basis := GREATEST(COALESCE(v_row.total_cents, 0), COALESCE(v_row.estimated_total_cents, 0));
    v_pax := GREATEST(COALESCE(v_row.guests, 0), 0);
    IF v_pax = 0 THEN
      v_pax := GREATEST(COALESCE(v_row.adults, 0), 0) + GREATEST(COALESCE(v_row.children_count, 0), 0);
    END IF;
    v_pax := GREATEST(v_pax, 1);

    v_currency := COALESCE(v_row.booking_currency, 'USD');
    v_rate := COALESCE(v_row.exchange_rate_mvr_per_usd, 18);
    v_comm_mode := COALESCE(v_row.commission_mode, v_row.activity_mode, 'fixed');
    -- The booking's own snapshot wins; fall back to the activity's current rule.
    v_pct := COALESCE(v_row.commission_percent, v_row.activity_percent);
    v_fixed := COALESCE(v_row.activity_fixed, 0);

    IF v_comm_mode = 'percent' AND COALESCE(v_pct, 0) > 0 AND v_basis > 0 THEN
      -- The basis IS the booking total, so the result is already in the
      -- booking's currency and must not be converted again below.
      v_new_comm := ROUND(v_basis * v_pct / 100.0);
    ELSE
      v_comm_mode := 'fixed';
      v_pct := NULL;
      -- activity.commission_cents is per guest, quoted in the ACTIVITY's
      -- currency. Convert the rate to the booking's currency at the rate the
      -- booking snapshotted; a mixed-currency commission used to be summed as
      -- USD and land 18x off.
      IF v_fixed > 0 THEN
        IF v_currency = 'USD' AND COALESCE(v_row.activity_currency, 'USD') = 'MVR' THEN
          v_new_comm := ROUND((v_fixed / v_rate) * v_pax);
        ELSIF v_currency = 'MVR' AND COALESCE(v_row.activity_currency, 'USD') = 'USD' THEN
          v_new_comm := ROUND((v_fixed * v_rate) * v_pax);
        ELSE
          v_new_comm := v_fixed * v_pax;
        END IF;
      ELSE
        v_new_comm := 0;
      END IF;
    END IF;

    v_new_net := CASE WHEN public.net_was_unset(v_row.net_cents, v_basis)
                      THEN GREATEST(v_basis - v_new_comm, 0)
                      ELSE COALESCE(v_row.net_cents, 0) END;
    v_net_touch := (v_new_net <> COALESCE(v_row.net_cents, 0));

    IF v_new_comm = COALESCE(v_row.commission_cents, 0) AND NOT v_net_touch THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_changed := v_changed + 1;
    IF v_net_touch THEN
      v_nets := v_nets + 1;
    END IF;
    v_old_sum := v_old_sum + COALESCE(v_row.commission_cents, 0);
    v_new_sum := v_new_sum + v_new_comm;

    IF jsonb_array_length(v_samples) < 10 THEN
      v_samples := v_samples || jsonb_build_array(jsonb_build_object(
        'ref', v_row.booking_ref,
        'date', v_row.booking_date,
        'old_cents', COALESCE(v_row.commission_cents, 0),
        'new_cents', v_new_comm
      ));
    END IF;

    IF p_apply THEN
      UPDATE public.bookings b
         SET commission_cents  = v_new_comm,
             commission_mode   = v_comm_mode,
             commission_percent = v_pct,
             commission_currency = v_currency,
             net_cents         = v_new_net
       WHERE b.id = v_row.id;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'from', p_from,
    'to', p_to,
    'applied', p_apply,
    'changed', v_changed,
    'unchanged', v_skipped,
    'nets_adjusted', v_nets,
    'old_commission_cents', v_old_sum,
    'new_commission_cents', v_new_sum,
    'samples', v_samples
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE ALL ON FUNCTION public.backfill_booking_commission(DATE, DATE, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_booking_commission(DATE, DATE, BOOLEAN)
  TO authenticated;

COMMIT;