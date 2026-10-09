-- ================================================================
-- 059 — Cash register: Euro support + note/coin breakdown counts
-- ================================================================
-- Extends the daily till to three currencies (USD, MVR, EUR) and stores
-- the physical count as note/coin quantities per currency.
--
--   * cash_registers gains eur opening/closing columns and jsonb
--     opening_counts / closing_counts ({ "<minor>": quantity } per
--     denomination, keyed by currency) so the exact float and the exact
--     counted till are preserved for audit.
--   * cash_register_entries currency check now allows EUR.
--
-- Idempotent — safe to re-run.
-- ================================================================

alter table public.cash_registers add column if not exists opening_cash_eur_cents int not null default 0 check (opening_cash_eur_cents >= 0);
alter table public.cash_registers add column if not exists closing_cash_eur_cents int check (closing_cash_eur_cents >= 0);
alter table public.cash_registers add column if not exists opening_counts jsonb;
alter table public.cash_registers add column if not exists closing_counts jsonb;

alter table public.cash_register_entries drop constraint if exists cash_register_entries_currency_check;
alter table public.cash_register_entries add constraint cash_register_entries_currency_check
  check (currency in ('USD', 'MVR', 'EUR'));