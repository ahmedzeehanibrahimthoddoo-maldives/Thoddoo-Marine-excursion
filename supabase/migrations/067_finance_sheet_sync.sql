-- ================================================================
-- 067 — Google Sheet finance sync: other income ledger + sync columns
-- ================================================================
-- Owner decision (2026-09-28): financial lines can be logged in a single
-- Google Sheet and synced into the system automatically.
--
--   Expenses tab   -> public.expenses   (costs: boat fuel, outsider boat
--                                        hire for trips, crew, supplies…)
--   OtherIncome tab -> public.other_income (money received outside guest
--                                        bookings: our boat hired by a
--                                        second operator, etc.)
--
-- Sync model (chosen by owner):
--   * Upsert by an ID column — each row keeps a stable external_id that the
--     sync writes back into the sheet, so edits update and new rows insert.
--   * A row deleted from the sheet is ARCHIVED (excluded from UI + reports)
--     but kept for audit; re-adding the row with the same ID restores it.
--   * Currencies are per-row USD or MVR (never auto-converted).
-- Access: owner & manager only, identical to expenses.
-- ================================================================

BEGIN;

-- ================================================================
-- 1. EXPENSES — add sync columns (external_id + archived_at)
-- ================================================================
alter table public.expenses
  add column if not exists external_id text,
  add column if not exists archived_at timestamptz;

drop index if exists expenses_external_id_idx;
create unique index expenses_external_id_idx
  on public.expenses (external_id) where external_id is not null;

create index if not exists expenses_archived_idx on public.expenses (archived_at);

-- ================================================================
-- 2. OTHER INCOME ledger
-- ================================================================
create table if not exists public.other_income (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Other',
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'MVR' check (currency in ('USD', 'MVR')),
  income_date date not null default (now() at time zone 'UTC')::date,
  vendor text,
  notes text,
  external_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists other_income_date_idx on public.other_income (income_date);
create index if not exists other_income_category_idx on public.other_income (category);
create index if not exists other_income_archived_idx on public.other_income (archived_at);
drop index if exists other_income_external_id_idx;
create unique index other_income_external_id_idx
  on public.other_income (external_id) where external_id is not null;

alter table public.other_income enable row level security;

drop policy if exists "other_income_select_owner_manager" on public.other_income;
create policy "other_income_select_owner_manager" on public.other_income
  for select
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
    )
  );

drop policy if exists "other_income_write_owner_manager" on public.other_income;
create policy "other_income_write_owner_manager" on public.other_income
  for all to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
    )
  );

COMMIT;