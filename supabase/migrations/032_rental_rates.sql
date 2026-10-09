-- 032_rental_rates.sql
-- Seed default daily rental rates + deposits for the items the resort rents out.
-- These are editable from Fleet ▸ Equipment (Daily Rate / Deposit / Currency).

begin;

UPDATE public.equipment
SET daily_rate_cents = 1000, deposit_cents = 5000, currency = 'USD'
WHERE name IN ('Fins (Adult)', 'Snorkel Set (mask + snorkel)') AND active = true;

commit;