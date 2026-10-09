-- =============================================
-- Migration 084: Quick invoice — bill-to email optional
--
-- The Invoices page gains "+ New invoice": staff type a person or company, a
-- trip and an amount, and immediately get an invoice (stored as a booking so
-- it keeps its invoice number, PDF, email button, payments and revenue).
--
-- Migration 072 gates every bookings INSERT/UPDATE on the customer having a
-- valid email, so a walk-in bill-to with no address could not be invoiced at
-- all. Rows raised by the quick-invoice flow carry bookings.email_optional =
-- true and are exempt from that one gate; every other booking keeps it.
-- The guest can still capture an address later via set_consent_email before
-- signing a waiver, and staff can add the email to the customer record at any
-- time (at which point the row satisfies the gate regardless of the flag).
-- =============================================

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS email_optional BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.email_optional IS
  'Quick invoice raised with no bill-to email on file: exempt from the 072 customer-email gate.';

CREATE OR REPLACE FUNCTION public._require_customer_email_for_booking()
RETURNS trigger AS $$
DECLARE
  v_email text;
BEGIN
  -- Quick invoices may be addressed later (PDF / WhatsApp copy instead), so
  -- the email gate is explicitly waived for the rows that asked for it.
  IF NEW.email_optional IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT email INTO v_email FROM customers WHERE id = NEW.customer_id;
    IF v_email IS NULL OR NOT public.is_valid_email(v_email) THEN
      RAISE EXCEPTION 'A valid email is required for every booking. Please add the guest email to the customer record.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
