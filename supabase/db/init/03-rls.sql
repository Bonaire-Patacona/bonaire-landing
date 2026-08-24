-- =============================================================================
-- Row level security
--
-- Rules of the house:
--   * anon      -> may only call the read-only availability/rate RPCs
--   * authenticated + profiles.role = 'admin' -> full back-office access
--   * service_role (Nitro server routes) -> bypasses RLS, used for anything
--     that touches money or writes on behalf of a guest
-- =============================================================================

alter view public.calendar_blocks set (security_invoker = true);

alter table public.profiles         enable row level security;
alter table public.app_settings     enable row level security;
alter table public.rate_periods     enable row level security;
alter table public.rate_overrides   enable row level security;
alter table public.cancellation_policies enable row level security;
alter table public.bookings         enable row level security;
alter table public.booking_payments enable row level security;
alter table public.blocked_dates    enable row level security;
alter table public.open_periods     enable row level security;
alter table public.ical_feeds       enable row level security;
alter table public.external_blocks  enable row level security;
alter table public.stripe_events    enable row level security;

-- profiles ---------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admin-only tables ------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'rate_periods', 'rate_overrides', 'cancellation_policies',
    'bookings', 'booking_payments',
    'blocked_dates', 'open_periods', 'ical_feeds', 'external_blocks'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t
    );
  end loop;
end;
$$;

-- stripe_events is service-role only: no policy at all, RLS denies everyone else.

-- -----------------------------------------------------------------------------
-- Table grants
--
-- RLS narrows what a role may touch, it does not grant anything: without a
-- GRANT, PostgREST fails with "permission denied" before a policy is ever
-- evaluated. Supabase's default privileges are attached to the `postgres` role,
-- and this schema is applied by `supabase_admin`, so the grants are spelled out
-- here rather than inherited.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'rate_periods', 'rate_overrides', 'cancellation_policies',
    'bookings', 'booking_payments',
    'blocked_dates', 'open_periods', 'ical_feeds', 'external_blocks'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

grant all on public.stripe_events to service_role;

-- -----------------------------------------------------------------------------
-- Function and view grants
-- -----------------------------------------------------------------------------
revoke all on public.calendar_blocks from anon;
grant select on public.calendar_blocks to authenticated, service_role;

revoke all on function public.expire_stale_holds()      from anon, authenticated;
revoke all on function public.complete_past_bookings()  from anon, authenticated;
grant execute on function public.expire_stale_holds()     to service_role;
grant execute on function public.complete_past_bookings() to service_role;

grant execute on function public.unavailable_days(date, date)          to anon, authenticated, service_role;
grant execute on function public.rate_calendar(date, date)             to anon, authenticated, service_role;
grant execute on function public.nightly_rate_cents(date)              to anon, authenticated, service_role;
grant execute on function public.is_range_available(date, date, uuid)  to anon, authenticated, service_role;
grant execute on function public.is_range_open(date, date)             to anon, authenticated, service_role;
grant execute on function public.is_admin()                            to authenticated, service_role;
