-- 083_payment_income_ledger.sql
--
-- Money that has actually been received belongs in the income ledger.
--
-- Bookings keep their own `payment_status`, but there was no single place that
-- said "this is income we now have": the Income page only listed rows somebody
-- typed in by hand (other_income), while every completed payment sat solely on
-- the payments row. So marking a booking paid moved the Collected figure and
-- nothing else, and the Income page under-reported what had come in.
--
-- This mirrors each completed payment into `other_income`, keyed 1:1 on
-- `payment_id`, so:
--   * the Income page shows guest money alongside hand-entered income,
--   * a voided/refunded payment is archived again rather than lingering as
--     income that was never kept,
--   * a payment can never produce two rows (unique index),
--   * payment-derived rows are excluded from the Zoho "Other Income" sync and
--     from the profit calculation, because guest revenue already counts them
--     once — they are a view of received money, not extra money.
--
-- The backfill loads the completed payments already on file so the ledger is
-- honest about the past too, not just from today onward.

begin;

-- ============================================================
-- 1. Link a ledger row to the payment it came from
-- ============================================================
alter table public.other_income
  add column if not exists payment_id uuid references public.payments (id) on delete cascade;

create unique index if not exists other_income_payment_id_idx
  on public.other_income (payment_id)
  where payment_id is not null;

comment on column public.other_income.payment_id is
  'Set when the row was mirrored from a completed payment. NULL = hand-entered income. Excluded from the Zoho Other Income sync and from profit, since guest revenue already counts it.';

-- ============================================================
-- 2. Keep the ledger in step with payments
-- ============================================================
create or replace function public.sync_payment_to_income()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind     text;
  v_title    text;
  v_vendor   text;
  v_notes    text;
  v_date     date;
  v_existing uuid;
begin
  -- Payments are restricted to a booking or a rental by
  -- chk_payments_booking_or_rental, so one of the two branches always applies.
  v_notes := nullif(
    case
      when new.reference is not null then new.method || ' · ref ' || new.reference
      else new.method
    end, ''
  );

  if new.status = 'completed' then
    if new.booking_id is not null then
      select coalesce(b.booking_ref, left(b.id::text, 8)) || ' · ' || coalesce(a.name, 'Booking'),
             nullif(coalesce(c.full_name, ''), '')
      into v_title, v_vendor
      from public.bookings b
      left join public.activities a on a.id = b.activity_id
      left join public.customers  c on c.id = b.customer_id
      where b.id = new.booking_id;
      v_kind := 'Trip Payment';
    else
      select coalesce(e.name, 'Equipment') || ' · ' ||
             coalesce(b.booking_ref, left(r.id::text, 8)),
             nullif(coalesce(c.full_name, ''), '')
      into v_title, v_vendor
      from public.equipment_rentals r
      left join public.equipment   e on e.id = r.equipment_id
      left join public.bookings    b on b.id = r.booking_id
      left join public.customers   c on c.id = r.customer_id
      where r.id = new.rental_id;
      v_kind := 'Rental Payment';
    end if;

    v_date := (new.created_at at time zone 'Indian/Maldives')::date;

    select id into v_existing
    from public.other_income
    where payment_id = new.id;

    if v_existing is null then
      insert into public.other_income
        (title, category, amount_cents, currency, income_date, vendor, notes, payment_id)
      values
        (coalesce(nullif(trim(v_title), ''), 'Guest payment'),
         v_kind,
         greatest(coalesce(new.amount_cents, 0), 0),
         coalesce(new.currency, 'USD'),
         v_date,
         v_vendor,
         v_notes,
         new.id);
    else
      -- Re-activated after a void was reversed: the amount may have changed too.
      update public.other_income
         set archived_at   = null,
             amount_cents  = greatest(coalesce(new.amount_cents, 0), 0),
             currency      = coalesce(new.currency, 'USD'),
             income_date   = v_date,
             notes         = v_notes,
             title         = coalesce(nullif(trim(v_title), ''), 'Guest payment'),
             category      = v_kind
       where id = v_existing;
    end if;

  elsif old.status = 'completed' then
    -- Voided or refunded: the money is no longer income, so take the row out of
    -- every report (they all filter archived_at is null) without deleting the
    -- audit trail of what happened.
    update public.other_income
       set archived_at = coalesce(archived_at, now())
     where payment_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_payment_to_income on public.payments;
create trigger trg_sync_payment_to_income
  after insert or update on public.payments
  for each row
  execute function public.sync_payment_to_income();

-- SECURITY DEFINER so the ledger write succeeds for whoever records the payment
-- (the table's RLS policy is owner/manager only, but reception records payments
-- too). Internal to the trigger: execute is granted to the roles that write
-- payments and to nobody else.
revoke execute on function public.sync_payment_to_income() from public;
grant  execute on function public.sync_payment_to_income() to authenticated;
grant  execute on function public.sync_payment_to_income() to service_role;

-- ============================================================
-- 3. Backfill what has already been received
-- ============================================================
-- Only completed payments, and only where no row exists yet. Voided payments are
-- skipped outright rather than inserted then archived.
insert into public.other_income
  (title, category, amount_cents, currency, income_date, vendor, notes, payment_id)
select
  coalesce(nullif(
    case
      when p.booking_id is not null then
        coalesce(b.booking_ref, left(b.id::text, 8)) || ' · ' || coalesce(a.name, 'Booking')
      else
        coalesce(e.name, 'Equipment') || ' · ' || coalesce(b.booking_ref, left(r.id::text, 8))
    end, ''), 'Guest payment'),
  case when p.booking_id is not null then 'Trip Payment' else 'Rental Payment' end,
  greatest(coalesce(p.amount_cents, 0), 0),
  coalesce(p.currency, 'USD'),
  (p.created_at at time zone 'Indian/Maldives')::date,
  case when p.booking_id is not null
       then nullif(coalesce(c.full_name, ''), '')
       else nullif(coalesce(c2.full_name, ''), '') end,
  nullif(case when p.reference is not null then p.method || ' · ref ' || p.reference else p.method end, ''),
  p.id
from public.payments p
left join public.bookings b on b.id = p.booking_id
left join public.activities a on a.id = b.activity_id
left join public.customers c on c.id = b.customer_id
left join public.equipment_rentals r on r.id = p.rental_id
left join public.equipment e on e.id = r.equipment_id
left join public.customers c2 on c2.id = r.customer_id
where p.status = 'completed'
  and not exists (select 1 from public.other_income oi where oi.payment_id = p.id);

commit;
