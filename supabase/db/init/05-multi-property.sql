-- =============================================================================
-- Multi-property tenancy
--
-- Existing installations are adopted by a default property.  New domain rows
-- must always name their property, which keeps prices and calendars isolated.
-- =============================================================================

create table if not exists public.properties (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name        text not null,
  active      boolean not null default true,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists properties_one_default_idx
  on public.properties (is_default) where is_default;

insert into public.properties (slug, name, is_default)
select 'bonaire-patacona', coalesce((select property_name from public.app_settings where id = 1), 'Bonaire Patacona'), true
where not exists (select 1 from public.properties);

create or replace function public.default_property_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.properties where active order by is_default desc, created_at limit 1
$$;

-- Remove the original singleton restriction and give subsequent settings rows
-- a safe generated id. Keeping the numeric id avoids a destructive rewrite of
-- existing foreign/client contracts; property_id is the tenant identity.
alter table public.app_settings drop constraint if exists app_settings_id_check;
create sequence if not exists public.app_settings_id_seq;
select setval('public.app_settings_id_seq', greatest(coalesce((select max(id) from public.app_settings), 1), 1));
alter table public.app_settings alter column id set default nextval('public.app_settings_id_seq');

alter table public.app_settings add column if not exists property_id uuid;
update public.app_settings set property_id = public.default_property_id() where property_id is null;
alter table public.app_settings alter column property_id set not null;
alter table public.app_settings alter column property_id set default public.default_property_id();
alter table public.app_settings drop constraint if exists app_settings_property_id_fkey;
alter table public.app_settings add constraint app_settings_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;
create unique index if not exists app_settings_property_idx on public.app_settings (property_id);

-- Every table whose rows influence inventory or price is tenant-scoped.
do $$
declare t text;
begin
  foreach t in array array[
    'rate_periods', 'rate_overrides', 'bookings', 'blocked_dates',
    'open_periods', 'ical_feeds'
  ] loop
    execute format('alter table public.%I add column if not exists property_id uuid', t);
    execute format('update public.%I set property_id = public.default_property_id() where property_id is null', t);
    execute format('alter table public.%I alter column property_id set not null', t);
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and conname = t || '_property_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (property_id) references public.properties(id) on delete cascade',
        t, t || '_property_id_fkey'
      );
    end if;
  end loop;
end $$;

create index if not exists rate_periods_property_dates_idx on public.rate_periods (property_id, start_date, end_date) where active;
create index if not exists bookings_property_dates_idx on public.bookings (property_id, check_in, check_out);
create index if not exists blocked_dates_property_dates_idx on public.blocked_dates (property_id, start_date, end_date);
create index if not exists open_periods_property_dates_idx on public.open_periods (property_id, start_date, end_date);
create index if not exists ical_feeds_property_idx on public.ical_feeds (property_id);

-- A date can be overridden once per property, rather than once globally.
alter table public.rate_overrides drop constraint if exists rate_overrides_pkey;
alter table public.rate_overrides add primary key (property_id, day);

-- Overlap protection is per property. Two different homes can of course host
-- guests on the same night.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    property_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'completed'));

create or replace view public.calendar_blocks with (security_invoker = true) as
  select b.id::text source_id, 'booking'::text kind, b.source channel,
         b.check_in start_date, b.check_out end_date, coalesce(b.guest_name, 'Reserva') label,
         b.reference, b.status, b.total_cents, b.currency,
         null::text event_kind, null::text link, null::boolean assume_reservations,
         b.property_id
    from public.bookings b where public.booking_blocks_calendar(b)
  union all
  select d.id::text, 'blocked', 'manual', d.start_date, d.end_date,
         coalesce(d.reason, 'Bloqueig'), null, null, null, null, null, null, null, d.property_id
    from public.blocked_dates d
  union all
  select e.id::text, 'external', f.channel, e.start_date, e.end_date,
         coalesce(e.summary, f.name), null, null, null, null, e.event_kind, e.link,
         coalesce(f.treat_closed_as_reservation, f.channel = 'booking'), f.property_id
    from public.external_blocks e join public.ical_feeds f on f.id = e.feed_id
   where f.active;

create or replace function public.is_range_available(
  p_property_id uuid, p_check_in date, p_check_out date, p_exclude_booking uuid default null
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_turnover integer; v_hit boolean;
begin
  if p_check_out <= p_check_in then return false; end if;
  select turnover_days into v_turnover from public.app_settings where property_id = p_property_id;
  select exists (
    select 1 from public.calendar_blocks cb
     where cb.property_id = p_property_id
       and (cb.kind <> 'booking' or p_exclude_booking is null or cb.source_id <> p_exclude_booking::text)
       and daterange(cb.start_date, cb.end_date, '[)') &&
           daterange(p_check_in - coalesce(v_turnover, 0), p_check_out + coalesce(v_turnover, 0), '[)')
  ) into v_hit;
  return not v_hit;
end $$;

create or replace function public.is_range_open(p_property_id uuid, p_from date, p_to date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_mode text;
begin
  select availability_mode into v_mode from public.app_settings where property_id = p_property_id;
  if coalesce(v_mode, 'open') <> 'closed' then return true; end if;
  return not exists (
    select 1 from generate_series(p_from, p_to - 1, interval '1 day') d
     where not exists (select 1 from public.open_periods o
       where o.property_id = p_property_id and d::date >= o.start_date and d::date < o.end_date)
  );
end $$;

create or replace function public.unavailable_days(
  p_property_id uuid, p_from date default current_date, p_to date default (current_date + 540)
) returns table (day date) language sql stable security definer set search_path = public as $$
  with s as (
    select availability_mode, advance_notice_days, booking_window_days
      from public.app_settings where property_id = p_property_id
  ), taken as (
    select distinct d::date as day from public.calendar_blocks cb
    cross join lateral generate_series(greatest(cb.start_date, p_from), least(cb.end_date - 1, p_to), interval '1 day') d
    where cb.property_id = p_property_id and cb.start_date <= p_to and cb.end_date > p_from
  ), off_policy as (
    select d::date as day from s, generate_series(p_from, p_to, interval '1 day') d
    where d::date < current_date + s.advance_notice_days
       or d::date > current_date + s.booking_window_days
       or (s.availability_mode = 'closed' and not exists (
         select 1 from public.open_periods o where o.property_id = p_property_id
           and d::date >= o.start_date and d::date < o.end_date))
  )
  select day from taken union select day from off_policy order by 1
$$;

create or replace function public.nightly_rate_cents(p_property_id uuid, p_day date)
returns integer language plpgsql stable security definer set search_path = public as $$
declare s public.app_settings%rowtype; rp public.rate_periods%rowtype;
        v_override integer; v_base integer; v_uplift numeric;
begin
  select nightly_cents into v_override from public.rate_overrides
   where property_id = p_property_id and day = p_day;
  if v_override is not null then return v_override; end if;
  select * into s from public.app_settings where property_id = p_property_id;
  select * into rp from public.rate_periods r
   where r.property_id = p_property_id and r.active and p_day between r.start_date and r.end_date
   order by r.priority desc, (r.end_date - r.start_date) asc limit 1;
  v_base := coalesce(rp.nightly_cents, s.base_nightly_cents);
  v_uplift := coalesce(rp.weekend_uplift_pct, s.weekend_uplift_pct, 0);
  if extract(isodow from p_day) in (5, 6) and v_uplift > 0 then
    return round(v_base * (1 + v_uplift / 100.0))::integer;
  end if;
  return v_base;
end $$;

create or replace function public.rate_calendar(
  p_property_id uuid, p_from date default current_date, p_to date default (current_date + 365)
) returns table (day date, nightly_cents integer, min_nights integer, available boolean, overridden boolean, note text)
language sql stable security definer set search_path = public as $$
  with un as (select u.day from public.unavailable_days(p_property_id, p_from, p_to) u)
  select d::date,
    public.nightly_rate_cents(p_property_id, d::date),
    coalesce(
      (select o.min_nights from public.rate_overrides o where o.property_id = p_property_id and o.day = d::date),
      (select r.min_nights from public.rate_periods r
        where r.property_id = p_property_id and r.active and r.min_nights is not null
          and d::date between r.start_date and r.end_date order by r.priority desc limit 1),
      (select s.min_nights from public.app_settings s where s.property_id = p_property_id)
    ),
    not exists (select 1 from un where un.day = d::date),
    exists (select 1 from public.rate_overrides o where o.property_id = p_property_id and o.day = d::date),
    (select o.note from public.rate_overrides o where o.property_id = p_property_id and o.day = d::date)
  from generate_series(p_from, p_to, interval '1 day') d order by 1
$$;

-- Compatibility signatures now delegate to the designated default property;
-- they no longer scan inventory belonging to every property.
create or replace function public.is_range_available(p_check_in date, p_check_out date, p_exclude_booking uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_range_available(public.default_property_id(), $1, $2, $3)
$$;
create or replace function public.is_range_open(p_from date, p_to date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_range_open(public.default_property_id(), $1, $2)
$$;
create or replace function public.unavailable_days(p_from date default current_date, p_to date default (current_date + 540))
returns table (day date) language sql stable security definer set search_path = public as $$
  select * from public.unavailable_days(public.default_property_id(), $1, $2)
$$;
create or replace function public.nightly_rate_cents(p_day date)
returns integer language sql stable security definer set search_path = public as $$
  select public.nightly_rate_cents(public.default_property_id(), $1)
$$;
create or replace function public.rate_calendar(p_from date default current_date, p_to date default (current_date + 365))
returns table (day date, nightly_cents integer, min_nights integer, available boolean, overridden boolean, note text)
language sql stable security definer set search_path = public as $$
  select * from public.rate_calendar(public.default_property_id(), $1, $2)
$$;

alter table public.properties enable row level security;
drop policy if exists "public can read active properties" on public.properties;
create policy "public can read active properties" on public.properties for select using (active or public.is_admin());
drop policy if exists "admins manage properties" on public.properties;
create policy "admins manage properties" on public.properties for all using (public.is_admin()) with check (public.is_admin());

grant select on public.properties to anon, authenticated, service_role;
grant insert, update, delete on public.properties to authenticated, service_role;
grant execute on function public.is_range_available(uuid, date, date, uuid) to anon, authenticated, service_role;
grant execute on function public.is_range_open(uuid, date, date) to anon, authenticated, service_role;
grant execute on function public.unavailable_days(uuid, date, date) to anon, authenticated, service_role;
grant execute on function public.nightly_rate_cents(uuid, date) to anon, authenticated, service_role;
grant execute on function public.rate_calendar(uuid, date, date) to anon, authenticated, service_role;
grant select on public.calendar_blocks to authenticated, service_role;
