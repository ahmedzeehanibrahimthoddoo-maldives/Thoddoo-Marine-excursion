-- ================================================================
-- 058 — Cash register (daily till)
-- ================================================================
-- A daily cash register per business day:
--   * cash_registers      — one row per day; status 'open' or 'closed'
--   * cash_register_entries — every collection (cash/card/bank transfer)
--                            or ledger bill booked during that day,
--                            plus cash paid OUT as expenses
--
-- Money stays in its own currency (USD cents / MVR laari). Cash position:
--   expected cash = opening + cash in − cash out (expenses)
--   over/short    = counted (closing) − expected
--
-- Only one register may be open at a time, and only one register may be
-- open for a given date (partial unique indexes enforce both).
-- Access: owner, manager & reception (daily collections are operationally
-- visible to reception; closing amounts stay visible to all three).
-- ================================================================

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  register_date date not null default (now() at time zone 'UTC')::date,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_cash_usd_cents int not null default 0 check (opening_cash_usd_cents >= 0),
  opening_cash_mvr_laari int not null default 0 check (opening_cash_mvr_laari >= 0),
  closing_cash_usd_cents int check (closing_cash_usd_cents >= 0),
  closing_cash_mvr_laari int check (closing_cash_mvr_laari >= 0),
  notes text,
  opened_by uuid references public.staff_profiles(id),
  closed_by uuid references public.staff_profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (register_date)
);

create index if not exists cash_registers_date_idx on public.cash_registers (register_date);
create index if not exists cash_registers_status_idx on public.cash_registers (status);

-- Only one register may be OPEN at a time, and (already enforced by
-- unique register_date) only one register per date.
create unique index if not exists cash_registers_unique_open_date
  on public.cash_registers (register_date)
  where status = 'open';

create table if not exists public.cash_register_entries (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.cash_registers(id) on delete cascade,
  method text not null check (method in ('cash', 'card', 'bank_transfer', 'bill', 'expense')),
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency in ('USD', 'MVR')),
  reference text,
  notes text,
  booking_id uuid references public.bookings(id) on delete set null,
  recorded_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists cash_register_entries_register_idx on public.cash_register_entries (register_id);
create index if not exists cash_register_entries_method_idx on public.cash_register_entries (method);
create index if not exists cash_register_entries_date_idx on public.cash_register_entries (created_at);

alter table public.cash_registers enable row level security;
alter table public.cash_register_entries enable row level security;

drop policy if exists "cash_register_select_owner_manager_reception" on public.cash_registers;
create policy "cash_register_select_owner_manager_reception" on public.cash_registers
  for select
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  );

drop policy if exists "cash_register_write_owner_manager_reception" on public.cash_registers;
create policy "cash_register_write_owner_manager_reception" on public.cash_registers
  for all to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  );

drop policy if exists "cash_register_entries_select_owner_manager_reception" on public.cash_register_entries;
create policy "cash_register_entries_select_owner_manager_reception" on public.cash_register_entries
  for select
  using (
    exists (
      select 1 from public.cash_registers cr
      join public.staff_profiles sp on sp.user_id = auth.uid()
      where cr.id = register_id
        and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  );

drop policy if exists "cash_register_entries_write_owner_manager_reception" on public.cash_register_entries;
create policy "cash_register_entries_write_owner_manager_reception" on public.cash_register_entries
  for all to authenticated
  using (
    exists (
      select 1 from public.cash_registers cr
      join public.staff_profiles sp on sp.user_id = auth.uid()
      where cr.id = register_id
        and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  )
  with check (
    exists (
      select 1 from public.cash_registers cr
      join public.staff_profiles sp on sp.user_id = auth.uid()
      where cr.id = register_id
        and sp.role in ('owner', 'manager', 'reception') and sp.active
    )
  );