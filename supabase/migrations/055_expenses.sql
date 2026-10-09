-- ================================================================
-- 055 — Expense ledger
-- ================================================================
-- Date-based operating costs (boat fuel, water, crew, maintenance…).
-- Each expense is recorded when the money is spent, in the currency it
-- was paid in (MVR or USD). Reports then compute:
--   Net profit = Net revenue − Expenses  (Net = revenue after partner/commission split)
--
-- Categories are free-form text (the admin form suggests presets) so the
-- reports can group by category without a fixed enum.
-- Access: owner & manager only (finance-internal cost data).
-- ================================================================

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Other',
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'MVR' check (currency in ('USD', 'MVR')),
  expense_date date not null default (now() at time zone 'UTC')::date,
  vendor text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses (expense_date);
create index if not exists expenses_category_idx on public.expenses (category);

alter table public.expenses enable row level security;

drop policy if exists "expenses_select_owner_manager" on public.expenses;
create policy "expenses_select_owner_manager" on public.expenses
  for select
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager')
    )
  );

drop policy if exists "expenses_write_owner_manager" on public.expenses;
create policy "expenses_write_owner_manager" on public.expenses
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