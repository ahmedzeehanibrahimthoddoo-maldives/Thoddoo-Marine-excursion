-- ================================================================
-- 056 — Partner split refinement: no-partner trips net = gross
-- ================================================================
-- Follows 054. The split trigger only fills bookings.net_cents when the
-- activity has a commission/split configured. For ordinary products
-- (e.g. Sandbank Trip) net stayed at its blank value — the admin form
-- sanitizer writes an empty "Net (your take)" field as 0, and the ops
-- board then showed Rv $0.00 even when the guest total was recorded.
--
-- This migration extends the trigger: when the activity has NO partner
-- split, Thoddoo Marine keeps the full guest amount, so a blank net
-- falls back to the booking total (final total first, else estimate).
-- Explicitly-provided commissions/nets are never overwritten.
-- Idempotent via CREATE OR REPLACE on the same function.
-- ================================================================

CREATE OR REPLACE FUNCTION public.auto_partner_split_bookings()
RETURNS TRIGGER AS $$
DECLARE
  v_pax     INTEGER;
  v_comm    INTEGER;
  v_net     INTEGER;
  v_partner TEXT;
BEGIN
  IF NEW.activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.commission_cents, a.net_cents, a.partner
    INTO v_comm, v_net, v_partner
    FROM public.activities a
   WHERE a.id = NEW.activity_id;

  IF v_comm IS NULL OR v_net IS NULL THEN
    RETURN NEW;
  END IF;

  -- Partner name (only when not explicitly provided).
  IF NEW.partner IS NULL AND v_partner IS NOT NULL THEN
    NEW.partner := v_partner;
  END IF;

  IF v_comm > 0 OR v_net > 0 THEN
    -- Partner product (e.g. Resort Trip): split per guest, not per booking total.
    v_pax := GREATEST(COALESCE(NEW.guests, 0), 0);
    IF v_pax = 0 THEN
      v_pax := GREATEST(COALESCE(NEW.adults, 0), 0)
             + GREATEST(COALESCE(NEW.children_count, 0), 0);
    END IF;

    IF v_pax > 0 THEN
      IF NEW.commission_cents IS NULL OR NEW.commission_cents = 0 THEN
        NEW.commission_cents := v_comm * v_pax;
      END IF;
      IF NEW.net_cents IS NULL OR NEW.net_cents = 0 THEN
        NEW.net_cents := v_net * v_pax;
      END IF;
    END IF;
  ELSE
    -- No partner split: we keep the full guest amount. A blank net
    -- (sanitized to 0) falls back to the booking total so ops/reports
    -- revenue is never silently zeroed.
    IF (NEW.commission_cents IS NULL OR NEW.commission_cents = 0)
       AND (NEW.net_cents IS NULL OR NEW.net_cents = 0) THEN
      NEW.net_cents := GREATEST(COALESCE(NEW.total_cents, 0),
                                COALESCE(NEW.estimated_total_cents, 0));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;