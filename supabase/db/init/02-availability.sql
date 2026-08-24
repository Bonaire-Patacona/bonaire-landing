-- =============================================================================
-- Availability + pricing helpers (callable from PostgREST)
-- =============================================================================

-- Every date range that makes the property unavailable, from all sources.
--
-- The trailing columns are what the back-office calendar draws on a booking
-- pill; they are null for anything that is not a booking. Only ever appended
-- to, never reordered: `create or replace view` refuses anything else, and this
-- file is re-applied on every deploy.
create or replace view public.calendar_blocks as
  select
    b.id::text                    as source_id,
    'booking'::text               as kind,
    b.source                      as channel,
    b.check_in                    as start_date,
    b.check_out                   as end_date,
    coalesce(b.guest_name, 'Reserva') as label,
    b.reference                   as reference,
    b.status                      as status,
    b.total_cents                 as total_cents,
    b.currency                    as currency,
    null::text                    as event_kind,
    null::text                    as link,
    null::boolean                 as assume_reservations
  from public.bookings b
  where public.booking_blocks_calendar(b)
union all
  select
    d.id::text,
    'blocked'::text,
    'manual'::text,
    d.start_date,
    d.end_date,
    coalesce(d.reason, 'Bloqueig'),
    null::text,
    null::text,
    null::integer,
    null::text,
    null::text,
    null::text,
    null::boolean
  from public.blocked_dates d
union all
  select
    e.id::text,
    'external'::text,
    f.channel,
    e.start_date,
    e.end_date,
    coalesce(e.summary, f.name),
    null::text,
    null::text,
    null::integer,
    null::text,
    e.event_kind,
    e.link,
    coalesce(f.treat_closed_as_reservation, f.channel = 'booking')
  from public.external_blocks e
  join public.ical_feeds f on f.id = e.feed_id
  where f.active;

comment on view public.calendar_blocks is
  'Union of confirmed/held bookings, manual blocks and imported iCal events.';

-- Is [p_check_in, p_check_out) free? Ranges are half-open, so a checkout on the
-- same day as the next check-in does not collide (unless turnover_days > 0).
create or replace function public.is_range_available(
  p_check_in     date,
  p_check_out    date,
  p_exclude_booking uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_turnover integer;
  v_hit      boolean;
begin
  if p_check_out <= p_check_in then
    return false;
  end if;

  select turnover_days into v_turnover from public.app_settings where id = 1;
  v_turnover := coalesce(v_turnover, 0);

  select exists (
    select 1
    from public.calendar_blocks cb
    where (cb.kind <> 'booking' or p_exclude_booking is null or cb.source_id <> p_exclude_booking::text)
      and daterange(cb.start_date, cb.end_date, '[)')
          && daterange(p_check_in - v_turnover, p_check_out + v_turnover, '[)')
  ) into v_hit;

  return not v_hit;
end;
$$;

-- Is the property even on sale on this range?
--
-- In 'open' mode it always is: only bookings and blocks take days off the
-- market. In 'closed' mode the calendar starts shut and every night of the stay
-- has to fall inside one of the ranges the host opened.
create or replace function public.is_range_open(p_from date, p_to date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  select availability_mode into v_mode from public.app_settings where id = 1;
  if coalesce(v_mode, 'open') <> 'closed' then
    return true;
  end if;

  return not exists (
    select 1
    from generate_series(p_from, p_to - 1, interval '1 day') as d
    where not exists (
      select 1 from public.open_periods o
      where d::date >= o.start_date and d::date < o.end_date
    )
  );
end;
$$;

-- Flat list of unavailable days for the public calendar widget: everything that
-- is physically taken, plus everything the booking policy keeps off the market
-- (outside the rolling window, or not opened yet in 'closed' mode).
create or replace function public.unavailable_days(
  p_from date default current_date,
  p_to   date default (current_date + 540)
)
returns table (day date)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select availability_mode, advance_notice_days, booking_window_days
    from public.app_settings where id = 1
  ),
  taken as (
    select distinct d::date as day
    from public.calendar_blocks cb
    cross join lateral generate_series(
      greatest(cb.start_date, p_from),
      least(cb.end_date - 1, p_to),
      interval '1 day'
    ) as d
    where cb.start_date <= p_to and cb.end_date > p_from
  ),
  off_policy as (
    select d::date as day
    from s, generate_series(p_from, p_to, interval '1 day') as d
    where d::date < current_date + s.advance_notice_days
       or d::date > current_date + s.booking_window_days
       or (s.availability_mode = 'closed' and not exists (
             select 1 from public.open_periods o
             where d::date >= o.start_date and d::date < o.end_date
           ))
  )
  select day from taken
  union
  select day from off_policy
  order by 1;
$$;

-- Nightly rate for one specific date, applying the highest-priority active
-- season that covers it, then the weekend uplift.
create or replace function public.nightly_rate_cents(p_day date)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s            public.app_settings%rowtype;
  rp           public.rate_periods%rowtype;
  v_override   integer;
  v_base       integer;
  v_uplift     numeric;
  v_is_weekend boolean;
begin
  -- A price typed on the calendar is final: no season, no weekend uplift.
  select nightly_cents into v_override
  from public.rate_overrides where day = p_day;
  if v_override is not null then
    return v_override;
  end if;

  select * into s from public.app_settings where id = 1;

  select * into rp
  from public.rate_periods r
  where r.active and p_day between r.start_date and r.end_date
  order by r.priority desc, (r.end_date - r.start_date) asc
  limit 1;

  v_base   := coalesce(rp.nightly_cents, s.base_nightly_cents);
  v_uplift := coalesce(rp.weekend_uplift_pct, s.weekend_uplift_pct, 0);

  -- Friday (5) and Saturday (6) nights
  v_is_weekend := extract(isodow from p_day) in (5, 6);

  if v_is_weekend and v_uplift > 0 then
    return round(v_base * (1 + v_uplift / 100.0))::integer;
  end if;

  return v_base;
end;
$$;

-- Per-night prices + the minimum stay that applies to a check-in date.
-- The shape changed when per-day overrides arrived, and `create or replace`
-- cannot widen a returns-table, so the old one goes first.
drop function if exists public.rate_calendar(date, date);
create or replace function public.rate_calendar(
  p_from date default current_date,
  p_to   date default (current_date + 365)
)
returns table (
  day           date,
  nightly_cents integer,
  min_nights    integer,
  available     boolean,
  overridden    boolean,
  note          text
)
language sql
stable
security definer
set search_path = public
as $$
  with un as (select u.day from public.unavailable_days(p_from, p_to) u)
  select
    d::date,
    public.nightly_rate_cents(d::date),
    coalesce(
      (select o.min_nights from public.rate_overrides o where o.day = d::date),
      (select r.min_nights
         from public.rate_periods r
        where r.active and r.min_nights is not null
          and d::date between r.start_date and r.end_date
        order by r.priority desc
        limit 1),
      (select min_nights from public.app_settings where id = 1)
    ),
    not exists (select 1 from un where un.day = d::date),
    exists (select 1 from public.rate_overrides o where o.day = d::date),
    (select o.note from public.rate_overrides o where o.day = d::date)
  from generate_series(p_from, p_to, interval '1 day') as d
  order by 1;
$$;

-- Sweep expired holds. Called by the Nitro scheduled task and before quoting.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.bookings
       set status = 'expired',
           cancelled_at = now(),
           cancellation_reason = coalesce(cancellation_reason, 'Hold expired without payment')
     where status = 'pending'
       and hold_expires_at is not null
       and hold_expires_at < now()
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- Mark past confirmed stays as completed.
create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with done as (
    update public.bookings
       set status = 'completed'
     where status = 'confirmed'
       and check_out < current_date
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;
