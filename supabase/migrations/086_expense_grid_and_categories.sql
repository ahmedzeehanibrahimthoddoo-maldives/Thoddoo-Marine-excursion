-- ================================================================
-- 086 — Expense grid entry + P&L category names
-- ================================================================
-- The monthly expense sheet (Date | Detail | Liter petrol | Rate |
-- Petrol | Engine Oil | Sparking Plug | Oil Filter | Hire Equipment |
-- Other Services | Asset_Small | Electricity | Commission) is now
-- entered straight into the app, so a grid cell has to survive
-- re-saving the month: `entry_key` is YYYY-MM-DD:column, unique, and
-- lets the grid upsert instead of piling up duplicates. Hand-entered
-- rows leave it null.
--
-- Categories are renamed to the P&L lines the sheet rolls up into
-- (Fuel, Repair & Maintenance, Hire Equipment, Commissions, Salary,
-- Electricity, Asset-Small, Other Services). Existing rows are mapped
-- across; the presets in the form follow the same list.
-- ================================================================

begin;

-- ============================================================
-- 1. Grid rows key their cell, not their id
-- ============================================================
alter table public.expenses
  add column if not exists entry_key text;

drop index if exists expenses_entry_key_idx;
create unique index expenses_entry_key_idx
  on public.expenses (entry_key)
  where entry_key is not null;

comment on column public.expenses.entry_key is
  'YYYY-MM-DD:column when the row was written by the monthly expense grid, so re-saving the month upserts instead of duplicating. NULL = hand-entered or imported row.';

-- ============================================================
-- 2. Category names become the P&L lines
-- ============================================================
update public.expenses set category = 'Fuel'
  where category in ('Boat Fuel', 'Boat fuel', 'fuel', 'Petrol', 'petrol');

update public.expenses set category = 'Repair & Maintenance'
  where category in ('Maintenance', 'Repair & Maintance', 'Repairs', 'repair');

update public.expenses set category = 'Hire Equipment'
  where category in ('Equipment', 'Hire equipment');

update public.expenses set category = 'Commissions'
  where category in ('Commission', 'commission');

update public.expenses set category = 'Salary'
  where category in ('Crew', 'Salaries', 'Staff');

update public.expenses set category = 'Other Services'
  where category in ('Transfers', 'Services', 'services');

update public.expenses set category = 'Other'
  where category in ('Fees', 'Supplies', 'Water');

commit;
