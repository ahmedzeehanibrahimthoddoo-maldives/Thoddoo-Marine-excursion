-- =============================================
-- Migration 085: Walk-in rental requests (QR self-service)
--
-- Today a rental starts at the counter: staff picks an existing customer and
-- one unit, then hands over a QR for the guest to fill in details and sign.
-- There is no way for a guest to start it themselves — no walk-in QR like the
-- trips page has.
--
-- This adds that flow:
--   * rental_requests holds the basket a guest builds on their phone
--     (item types + quantities, their details, notes) before any unit is
--     assigned;
--   * consent_forms.rental_request_id lets the liability waiver be signed
--     against the request itself — units are assigned by staff at handover,
--     so the 069 check (equipment_rental needs a rental_id) is relaxed to
--     accept a request instead;
--   * equipment_rentals.rental_request_id records which request each
--     handed-out unit came from, so the return gate can find the one signed
--     waiver covering the whole basket;
--   * get_rental_catalog() shows guests what is free to take;
--   * submit_rental_request() creates the customer, the request and the
--     pending waiver in one call (token-keyed signing then happens through
--     the existing sign_consent_form).
-- =============================================

begin;

-- ---------------------------------------------------------------
-- 1. The basket a guest builds from the QR page
-- ---------------------------------------------------------------
create table if not exists public.rental_requests (
  id                       uuid primary key default gen_random_uuid(),
  customer_id              uuid not null references public.customers (id),
  guest_name               text not null,
  email                    text,
  phone                    text,
  nationality              text,
  date_of_birth            date,
  hotel                    text,
  room_number              text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  -- [{ "name": "Fins (Adult)", "qty": 2 }, ...]
  items                    jsonb not null default '[]'::jsonb,
  notes                    text,
  status                   text not null default 'open'
                             check (status in ('open', 'issued', 'cancelled')),
  consent_form_id          uuid references public.consent_forms (id),
  issued_at                timestamptz,
  cancelled_at             timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists idx_rental_requests_status  on public.rental_requests (status);
create index if not exists idx_rental_requests_customer on public.rental_requests (customer_id);

alter table public.rental_requests enable row level security;

drop policy if exists rental_requests_staff on public.rental_requests;
create policy rental_requests_staff on public.rental_requests
  for all
  using (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]))
  with check (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]));

-- ---------------------------------------------------------------
-- 2. The waiver may be signed against the request, before units exist
-- ---------------------------------------------------------------
alter table public.consent_forms
  add column if not exists rental_request_id uuid references public.rental_requests (id);

create index if not exists idx_consent_rental_request on public.consent_forms (rental_request_id);

alter table public.consent_forms drop constraint if exists consent_forms_rental_or_activity_check;
alter table public.consent_forms add constraint consent_forms_rental_or_activity_check check (
  (
    consent_type = 'equipment_rental'
    and activity_id is null
    and (rental_id is not null or rental_request_id is not null)
  )
  or
  (consent_type <> 'equipment_rental' and activity_id is not null)
);

-- ---------------------------------------------------------------
-- 3. Which request a handed-out unit came from
-- ---------------------------------------------------------------
alter table public.equipment_rentals
  add column if not exists rental_request_id uuid references public.rental_requests (id);

create index if not exists idx_rentals_request on public.equipment_rentals (rental_request_id);

-- ---------------------------------------------------------------
-- 4. Public: what a guest can take right now
-- ---------------------------------------------------------------
create or replace function public.get_rental_catalog()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with units as (
    select
      e.id,
      e.name,
      e.category,
      e.description,
      e.daily_rate_cents,
      e.deposit_cents,
      not exists (
        select 1
        from public.equipment_rentals r
        where r.equipment_id = e.id
          and r.status in ('checked_out', 'overdue')
      ) as is_free
    from public.equipment e
    where e.active = true
  ),
  grouped as (
    select
      u.name,
      u.category,
      max(u.description)                         as description,
      min(u.daily_rate_cents)                    as rate_cents,
      max(u.deposit_cents)                       as deposit_cents,
      count(*)                                   as total_units,
      count(*) filter (where u.is_free)          as free_units
    from units u
    group by u.name, u.category
  )
  select coalesce(
    json_agg(
      json_build_object(
        'name',          g.name,
        'category',      g.category,
        'description',   g.description,
        'rate_cents',    g.rate_cents,
        'deposit_cents', g.deposit_cents,
        'total_units',   g.total_units,
        'free_units',    g.free_units
      )
      order by g.category, g.name
    ),
    '[]'::json
  )
  from grouped g;
$$;

revoke all on function public.get_rental_catalog() from public;
grant  execute on function public.get_rental_catalog() to anon;
grant  execute on function public.get_rental_catalog() to authenticated;

-- ---------------------------------------------------------------
-- 5. Public: raise the request + its pending waiver
-- ---------------------------------------------------------------
create or replace function public.submit_rental_request(
  p_guest_name              text,
  p_email                   text,
  p_phone                   text,
  p_nationality             text default null,
  p_date_of_birth           date default null,
  p_hotel                   text default null,
  p_room_number             text default null,
  p_emergency_contact_name  text default null,
  p_emergency_contact_phone text default null,
  p_items                   jsonb default '[]'::jsonb,
  p_notes                   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name        text;
  v_email       text;
  v_phone       text;
  v_customer_id uuid;
  v_items       jsonb;
  v_item        jsonb;
  v_name_i      text;
  v_qty         int;
  v_free        int;
  v_total       int := 0;
  v_request_id  uuid;
  v_consent_id  uuid;
  v_template    public.consent_templates%rowtype;
  v_is_minor    boolean := false;
  v_stale       uuid;
begin
  v_name  := nullif(trim(p_guest_name), '');
  v_email := nullif(lower(trim(p_email)), '');
  v_phone := nullif(trim(p_phone), '');

  if v_name is null then
    return json_build_object('error', 'validation', 'message', 'Please enter your name.');
  end if;
  if v_email is null or not public.is_valid_email(v_email) then
    return json_build_object('error', 'validation', 'message', 'Please enter a valid email address — we send your copies there.');
  end if;
  if v_phone is null or length(v_phone) < 5 then
    return json_build_object('error', 'validation', 'message', 'Please enter a contact phone number.');
  end if;

  -- Migration 070 refuses to sign a rental waiver until these are on the row,
  -- so a request raised without them could never be signed — reject here.
  if nullif(trim(p_nationality), '') is null
     or p_date_of_birth is null
     or nullif(trim(p_hotel), '') is null
     or nullif(trim(p_emergency_contact_name), '') is null
     or nullif(trim(p_emergency_contact_phone), '') is null then
    return json_build_object(
      'error', 'validation',
      'message', 'All compulsory guest details must be completed: nationality, date of birth, phone, hotel and emergency contact — the rental waiver cannot be signed without them.'
    );
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('error', 'validation', 'message', 'Choose at least one item to rent.');
  end if;

  -- Validate the basket and cap it against what is actually free right now.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name_i := nullif(trim(v_item ->> 'name'), '');
    v_qty    := coalesce((v_item ->> 'qty')::int, 0);
    if v_name_i is null or v_qty < 1 or v_qty > 20 then
      return json_build_object('error', 'validation', 'message', 'That item selection is not valid.');
    end if;

    select count(*) filter (where not exists (
             select 1 from public.equipment_rentals r
              where r.equipment_id = e.id
                and r.status in ('checked_out', 'overdue')
           ))
      into v_free
      from public.equipment e
     where e.active = true
       and e.name = v_name_i;

    if v_free = 0 then
      return json_build_object('error', 'unavailable', 'message',
        v_name_i || ' is not available right now.');
    end if;
    if v_qty > v_free then
      return json_build_object('error', 'unavailable', 'message',
        'Only ' || v_free || ' × ' || v_name_i || ' available right now.');
    end if;
    v_total := v_total + v_qty;
  end loop;

  if v_total > 40 then
    return json_build_object('error', 'validation', 'message', 'That is a lot of gear — please ask our team for large orders.');
  end if;

  select * into v_template
  from public.consent_templates
  where consent_type = 'equipment_rental' and active = true;
  if not found then
    return json_build_object('error', 'template_missing', 'message', 'The rental waiver is unavailable. Please ask our team.');
  end if;

  -- Find or create the guest by address (same rule as the bookings flow).
  select id into v_customer_id from public.customers where lower(email) = v_email limit 1;
  if v_customer_id is null then
    insert into public.customers (full_name, email, phone)
    values (v_name, v_email, v_phone)
    returning id into v_customer_id;
  else
    update public.customers
       set phone = coalesce(nullif(phone, ''), v_phone),
           full_name = coalesce(nullif(full_name, ''), v_name)
     where id = v_customer_id;
  end if;

  -- One live walk-in waiver per customer: a re-submission supersedes the last
  -- unissued request (its waiver never led to equipment leaving the shop).
  -- A SIGNED waiver cannot be voided without 080's transaction-local flag —
  -- same signal the booking-cancellation path uses, scoped to this statement.
  for v_stale in
    select cf.rental_request_id
      from public.consent_forms cf
     where cf.rental_request_id is not null
       and cf.rental_id is null
       and cf.customer_id = v_customer_id
       and cf.status in ('pending', 'signed')
  loop
    perform set_config('app.consent_void_from_cancel', '1', true);
    update public.consent_forms
       set status = 'voided',
           void_reason = coalesce(nullif(trim(void_reason), ''), 'Walk-in rental request superseded'),
           voided_at = now(),
           voided_by = coalesce(voided_by, public.current_staff_id())
     where rental_request_id = v_stale
       and status in ('pending', 'signed');
    perform set_config('app.consent_void_from_cancel', '', true);
    update public.rental_requests
       set status = 'cancelled', cancelled_at = now()
     where id = v_stale and status = 'open';
  end loop;

  if p_date_of_birth is not null then
    v_is_minor := p_date_of_birth > (current_date - interval '18 years');
  end if;

  insert into public.rental_requests (
    customer_id, guest_name, email, phone, nationality, date_of_birth,
    hotel, room_number, emergency_contact_name, emergency_contact_phone,
    items, notes
  ) values (
    v_customer_id, v_name, v_email, v_phone,
    nullif(trim(p_nationality), ''), p_date_of_birth,
    nullif(trim(p_hotel), ''), nullif(trim(p_room_number), ''),
    nullif(trim(p_emergency_contact_name), ''), nullif(trim(p_emergency_contact_phone), ''),
    p_items, nullif(trim(p_notes), '')
  )
  returning id into v_request_id;

  insert into public.consent_forms (
    customer_id,
    rental_request_id,
    activity_id,
    activity_name,
    guest_name,
    email,
    phone,
    nationality,
    date_of_birth,
    hotel,
    room_number,
    emergency_contact_name,
    emergency_contact_phone,
    consent_type,
    status,
    consent_version,
    is_minor,
    form_version
  ) values (
    v_customer_id,
    v_request_id,
    null,
    'Equipment Rental',
    v_name,
    v_email,
    v_phone,
    nullif(trim(p_nationality), ''),
    p_date_of_birth,
    nullif(trim(p_hotel), ''),
    nullif(trim(p_room_number), ''),
    nullif(trim(p_emergency_contact_name), ''),
    nullif(trim(p_emergency_contact_phone), ''),
    'equipment_rental',
    'pending',
    v_template.version,
    v_is_minor,
    '1.0'
  )
  returning id into v_consent_id;

  update public.rental_requests set consent_form_id = v_consent_id where id = v_request_id;

  return json_build_object(
    'success', true,
    'request_id', v_request_id,
    'token', (select signing_token from public.consent_forms where id = v_consent_id)
  );
end;
$$;

revoke all on function public.submit_rental_request(text, text, text, text, date, text, text, text, text, jsonb, text) from public;
grant  execute on function public.submit_rental_request(text, text, text, text, date, text, text, text, text, jsonb, text) to anon;
grant  execute on function public.submit_rental_request(text, text, text, text, date, text, text, text, text, jsonb, text) to authenticated;

-- Staff read their own requests through RLS; the guest reads theirs by token
-- through the existing consent RPCs.

commit;
