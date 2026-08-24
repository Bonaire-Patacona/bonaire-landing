-- =============================================================================
-- Availability + pricing helpers (callable from PostgREST)
-- =============================================================================

-- Every date range that makes the property unavailable, from all sources.
create or replace view public.calendar_blocks as
  select
    b.id::text                    as source_id,
    'booking'::text               as kind,
    b.source                      as channel,
    b.check_in                    as start_date,
    b.check_out                   as end_date,
    coalesce(b.guest_name, 'Reserva') as label
  from public.bookings b
  where public.booking_blocks_calendar(b)
union all
  select
    d.id::text,
    'blocked'::text,
    'manual'::text,
    d.start_date,
    d.end_date,
    coalesce(d.reason, 'Bloqueig')
  from public.blocked_dates d
union all
  select
    e.id::text,
    'external'::text,
    f.channel,
    e.start_date,
    e.end_date,
    coalesce(e.summary, f.name)
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

-- Flat list of unavailable days for the public calendar widget.
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
  select distinct d::date
  from public.calendar_blocks cb
  cross join lateral generate_series(
    greatest(cb.start_date, p_from),
    least(cb.end_date - 1, p_to),
    interval '1 day'
  ) as d
  where cb.start_date <= p_to and cb.end_date > p_from
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
  v_base       integer;
  v_uplift     numeric;
  v_is_weekend boolean;
begin
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
create or replace function public.rate_calendar(
  p_from date default current_date,
  p_to   date default (current_date + 365)
)
returns table (day date, nightly_cents integer, min_nights integer, available boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    d::date,
    public.nightly_rate_cents(d::date),
    coalesce(
      (select r.min_nights
         from public.rate_periods r
        where r.active and r.min_nights is not null
          and d::date between r.start_date and r.end_date
        order by r.priority desc
        limit 1),
      (select min_nights from public.app_settings where id = 1)
    ),
    not exists (
      select 1 from public.calendar_blocks cb
      where daterange(cb.start_date, cb.end_date, '[)') @> d::date
    )
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
