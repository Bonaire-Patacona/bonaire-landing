-- =============================================================================
-- Bonaire Patacona — booking engine schema
-- Runs on first boot of the Postgres volume (docker-entrypoint-initdb.d).
-- To apply on an existing database:
--   psql "$SUPABASE_DB_URL" -f supabase/db/init/01-app-schema.sql
-- Every statement is idempotent so it is safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Profiles: who is allowed into /admin
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Back-office users. Only role = admin can write.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- Settings: one row holding the whole pricing / deposit configuration
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                        smallint primary key default 1 check (id = 1),
  property_name             text        not null default 'Bonaire Patacona',
  contact_email             text,
  currency                  text        not null default 'EUR',

  -- Base pricing (all money is stored in minor units / cents)
  base_nightly_cents        integer     not null default 9000 check (base_nightly_cents >= 0),
  weekend_uplift_pct        numeric(5,2) not null default 0 check (weekend_uplift_pct >= 0),
  cleaning_fee_cents        integer     not null default 4500 check (cleaning_fee_cents >= 0),
  tax_pct                   numeric(5,2) not null default 0 check (tax_pct >= 0),

  -- Occupancy
  guests_included           integer     not null default 2 check (guests_included >= 1),
  extra_guest_fee_cents     integer     not null default 1500 check (extra_guest_fee_cents >= 0),
  max_guests                integer     not null default 4 check (max_guests >= 1),

  -- Stay rules
  min_nights                integer     not null default 2 check (min_nights >= 1),
  max_nights                integer     not null default 30 check (max_nights >= 1),
  advance_notice_days       integer     not null default 1 check (advance_notice_days >= 0),
  booking_window_days       integer     not null default 540 check (booking_window_days >= 1),
  turnover_days             integer     not null default 0 check (turnover_days >= 0),
  checkin_time              text        not null default '16:00',
  checkout_time             text        not null default '11:00',

  -- Length-of-stay discounts
  weekly_discount_pct       numeric(5,2) not null default 0 check (weekly_discount_pct between 0 and 100),
  monthly_discount_pct      numeric(5,2) not null default 0 check (monthly_discount_pct between 0 and 100),

  -- Deposit charged online at booking time
  deposit_type              text        not null default 'percent' check (deposit_type in ('percent', 'fixed', 'full')),
  deposit_percent           numeric(5,2) not null default 30 check (deposit_percent between 0 and 100),
  deposit_fixed_cents       integer     not null default 0 check (deposit_fixed_cents >= 0),
  balance_due_days_before   integer     not null default 14 check (balance_due_days_before >= 0),

  -- Refundable damage deposit (informative, collected/held on arrival)
  security_deposit_cents    integer     not null default 0 check (security_deposit_cents >= 0),

  -- How long an unpaid booking holds the dates
  hold_minutes              integer     not null default 30 check (hold_minutes >= 5),

  -- Extra conditions shown underneath whichever policy applies.
  cancellation_policy       text        not null default '',
  ical_export_token         uuid        not null default gen_random_uuid(),
  updated_at                timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Columns added after the first release. `create table if not exists` above is a
-- no-op on a database that already has the table, so new settings arrive here.
alter table public.app_settings
  -- 'open'   -> every day is on sale unless something blocks it (the default)
  -- 'closed' -> only the ranges in public.open_periods are on sale
  add column if not exists availability_mode text not null default 'open'
    check (availability_mode in ('open', 'closed')),
  -- Charge the balance to the card the guest used at booking, unattended.
  add column if not exists auto_charge_balance boolean not null default true,
  -- How many days to keep retrying a declined balance charge before giving up
  -- and falling back to emailing a payment link.
  add column if not exists balance_retry_days integer not null default 3
    check (balance_retry_days >= 0),
  -- How the refundable damage deposit is handled:
  --   'none'         -> not collected through the site at all
  --   'card_on_file' -> nothing is held; damages are charged to the saved card
  -- A real hold is deliberately not on offer: Stripe releases an authorisation
  -- after ~7 days, so covering a stay would mean re-authorising every few days,
  -- and every renewal is another chance for the issuer to decline.
  add column if not exists security_deposit_mode text not null default 'none'
    check (security_deposit_mode in ('none', 'card_on_file')),
  -- Which of public.cancellation_policies applies to new bookings. Not a
  -- foreign key: a policy the host deletes must not take app_settings with it.
  add column if not exists cancellation_policy_code text not null default 'moderate';

-- -----------------------------------------------------------------------------
-- Cancellation policies
--
-- A policy is a refund ladder: "cancel at least `days_before` days before
-- check-in and you get `refund_pct` of what you paid back". Tiers are stored
-- most generous first; the first one the guest still qualifies for wins, and
-- falling off the end means no refund.
--
-- The four built-ins are seeded once and then belong to the host: a later
-- deploy will not overwrite an edited one.
-- -----------------------------------------------------------------------------
create table if not exists public.cancellation_policies (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique,
  name        text        not null,
  builtin     boolean     not null default false,
  tiers       jsonb       not null default '[]'::jsonb,
  notes       text        not null default '',
  active      boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.cancellation_policies (code, name, builtin, tiers, sort_order) values
  ('flexible', 'Flexible', true,
   '[{"days_before": 1, "refund_pct": 100}]'::jsonb, 10),
  ('moderate', 'Moderada', true,
   '[{"days_before": 14, "refund_pct": 100}, {"days_before": 7, "refund_pct": 50}]'::jsonb, 20),
  ('strict', 'Estricta', true,
   '[{"days_before": 30, "refund_pct": 100}, {"days_before": 14, "refund_pct": 50}]'::jsonb, 30),
  ('non_refundable', 'No reembolsable', true,
   '[]'::jsonb, 40)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Seasonal rates
-- -----------------------------------------------------------------------------
create table if not exists public.rate_periods (
  id                 uuid primary key default gen_random_uuid(),
  name               text        not null,
  start_date         date        not null,
  end_date           date        not null,
  nightly_cents      integer     not null check (nightly_cents >= 0),
  min_nights         integer     check (min_nights >= 1),
  weekend_uplift_pct numeric(5,2),
  priority           integer     not null default 0,
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  constraint rate_periods_range_valid check (end_date >= start_date)
);

create index if not exists rate_periods_range_idx on public.rate_periods (start_date, end_date) where active;

-- -----------------------------------------------------------------------------
-- Per-day overrides
--
-- The last word on what a single night costs, edited straight on the calendar.
-- Beats both the seasons and the base rate, and an explicit price is used as
-- typed: no weekend uplift is applied on top of it.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_overrides (
  day            date primary key,
  nightly_cents  integer check (nightly_cents >= 0),
  min_nights     integer check (min_nights >= 1),
  note           text,
  created_at     timestamptz not null default now(),
  constraint rate_overrides_not_empty check (nightly_cents is not null or min_nights is not null)
);

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------
create table if not exists public.bookings (
  id                        uuid primary key default gen_random_uuid(),
  reference                 text        not null unique,
  status                    text        not null default 'pending'
                              check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'completed')),
  source                    text        not null default 'direct'
                              check (source in ('direct', 'manual', 'airbnb', 'booking', 'vrbo', 'other')),

  check_in                  date        not null,
  check_out                 date        not null,
  adults                    integer     not null default 2 check (adults >= 1),
  children                  integer     not null default 0 check (children >= 0),

  guest_name                text        not null,
  guest_email               text        not null,
  guest_phone               text,
  guest_country             text,
  locale                    text        not null default 'es',
  notes                     text,

  currency                  text        not null default 'EUR',
  nightly_subtotal_cents    integer     not null default 0,
  cleaning_fee_cents        integer     not null default 0,
  extra_guest_cents         integer     not null default 0,
  discount_cents            integer     not null default 0,
  tax_cents                 integer     not null default 0,
  total_cents               integer     not null default 0,
  deposit_cents             integer     not null default 0,
  balance_cents             integer     not null default 0,
  amount_paid_cents         integer     not null default 0,
  security_deposit_cents    integer     not null default 0,
  price_breakdown           jsonb       not null default '[]'::jsonb,

  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_customer_id         text,
  balance_payment_url        text,
  balance_due_date           date,

  hold_expires_at           timestamptz,
  confirmed_at              timestamptz,
  cancelled_at              timestamptz,
  cancellation_reason       text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint bookings_range_valid check (check_out > check_in),
  constraint bookings_guests_valid check (adults + children >= 1)
);

-- Two guests cannot hold the same night. Enforced by the database rather than by
-- application code, so a race between two concurrent checkouts cannot double-book.
-- 'pending' is included: an unpaid hold blocks the dates until it is expired by
-- public.expire_stale_holds().
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (daterange(check_in, check_out, '[)') with &&)
      where (status in ('pending', 'confirmed', 'completed'));
  end if;
end;
$$;

create index if not exists bookings_dates_idx   on public.bookings (check_in, check_out);
create index if not exists bookings_status_idx  on public.bookings (status);
create index if not exists bookings_email_idx   on public.bookings (lower(guest_email));

-- The card the guest paid the deposit with, kept on file so the balance can be
-- charged off-session on balance_due_date. A card authorisation cannot be held
-- for more than 7 days, so the total is never pre-authorised: it is collected
-- in two merchant-initiated charges against the same payment method.
alter table public.bookings
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_saved_at timestamptz,
  add column if not exists balance_charge_status text not null default 'not_due'
    check (balance_charge_status in (
      'not_due',          -- nothing left to collect
      'scheduled',        -- card on file, waiting for balance_next_attempt_at
      'processing',       -- claimed by the payments task right now
      'succeeded',
      'requires_action',  -- the issuer wants the guest to authenticate (SCA)
      'failed',           -- retries exhausted; a payment link was generated
      'manual'            -- no card on file, the host collects it by hand
    )),
  add column if not exists balance_charge_attempts integer not null default 0,
  add column if not exists balance_next_attempt_at timestamptz,
  add column if not exists balance_last_error text;

create index if not exists bookings_balance_due_idx
  on public.bookings (balance_next_attempt_at)
  where balance_charge_status = 'scheduled';

-- The cancellation policy exactly as the guest accepted it. A snapshot rather
-- than a reference: editing a policy, or switching to another one, must never
-- change the terms of a booking that is already on the books.
alter table public.bookings
  add column if not exists cancellation_policy jsonb not null default '{}'::jsonb,
  add column if not exists refunded_cents integer not null default 0;

-- Bookings taken before policies existed carry no snapshot, and an empty one
-- reads as "no refund". The policy configured at the time is what actually
-- applied to them, so freeze that in instead of quietly hardening their terms.
-- Only ever touches rows that have never been stamped.
update public.bookings b
   set cancellation_policy = jsonb_build_object(
         'code',  p.code,
         'name',  p.name,
         'tiers', p.tiers,
         'notes', coalesce(concat_ws(E'\n\n', nullif(p.notes, ''), nullif(s.cancellation_policy, '')), '')
       )
  from public.app_settings s
  join public.cancellation_policies p on p.code = s.cancellation_policy_code
 where b.cancellation_policy = '{}'::jsonb;

-- A booking only blocks the calendar while it is pending (and not expired) or confirmed.
create or replace function public.booking_blocks_calendar(b public.bookings)
returns boolean
language sql
stable
as $$
  select b.status = 'confirmed'
      or b.status = 'completed'
      or (b.status = 'pending' and coalesce(b.hold_expires_at, 'infinity'::timestamptz) > now());
$$;

create table if not exists public.booking_payments (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references public.bookings (id) on delete cascade,
  kind                     text not null check (kind in ('deposit', 'balance', 'full', 'refund', 'security_deposit')),
  amount_cents             integer not null,
  currency                 text not null default 'EUR',
  status                   text not null default 'pending'
                             check (status in ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')),
  stripe_session_id        text,
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  raw                      jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists booking_payments_booking_idx on public.booking_payments (booking_id);

-- Stripe webhook idempotency
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Manual blocks (owner stays, maintenance, ...)
-- -----------------------------------------------------------------------------
create table if not exists public.blocked_dates (
  id          uuid primary key default gen_random_uuid(),
  start_date  date not null,
  end_date    date not null,          -- exclusive, same convention as bookings
  reason      text,
  created_at  timestamptz not null default now(),
  constraint blocked_dates_range_valid check (end_date > start_date)
);

create index if not exists blocked_dates_range_idx on public.blocked_dates (start_date, end_date);

-- -----------------------------------------------------------------------------
-- Open periods — the mirror image of blocked_dates.
--
-- Only consulted when app_settings.availability_mode = 'closed', where the
-- calendar starts entirely shut and a stay is only sellable if every one of its
-- nights falls inside one of these ranges.
-- -----------------------------------------------------------------------------
create table if not exists public.open_periods (
  id          uuid primary key default gen_random_uuid(),
  start_date  date not null,
  end_date    date not null,          -- exclusive, same convention as bookings
  note        text,
  created_at  timestamptz not null default now(),
  constraint open_periods_range_valid check (end_date > start_date)
);

create index if not exists open_periods_range_idx on public.open_periods (start_date, end_date);

-- -----------------------------------------------------------------------------
-- Two-way iCal sync
-- -----------------------------------------------------------------------------
create table if not exists public.ical_feeds (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  channel         text not null default 'other' check (channel in ('airbnb', 'booking', 'vrbo', 'other')),
  url             text not null,
  active          boolean not null default true,
  last_synced_at  timestamptz,
  last_status     text,
  last_error      text,
  events_count    integer not null default 0,
  created_at      timestamptz not null default now()
);

-- Some channels never say whether a busy night is a booking of theirs or a
-- block the host made: Booking.com exports both as 'CLOSED - Not available'.
-- When this is on, everything that feed closes is taken to be a reservation of
-- that channel. Null means "no opinion yet", which resolves to on for
-- Booking.com and off elsewhere — an explicit true/false always wins.
alter table public.ical_feeds
  add column if not exists treat_closed_as_reservation boolean;

create table if not exists public.external_blocks (
  id          uuid primary key default gen_random_uuid(),
  feed_id     uuid not null references public.ical_feeds (id) on delete cascade,
  uid         text not null,
  summary     text,
  start_date  date not null,
  end_date    date not null,          -- exclusive
  raw         text,
  synced_at   timestamptz not null default now(),
  unique (feed_id, uid),
  constraint external_blocks_range_valid check (end_date > start_date)
);

-- What the channel actually told us. Only some feeds distinguish the two:
-- Airbnb says 'Reserved' for a real booking, Booking.com exports every busy
-- night as 'CLOSED - Not available' whatever the reason. So 'closed' means
-- "unavailable, reason not disclosed", never "definitely not a booking".
alter table public.external_blocks
  add column if not exists event_kind text not null default 'closed'
    check (event_kind in ('reservation', 'closed')),
  -- Deep link back to the channel. Airbnb ships one on a real reservation;
  -- Booking.com ships nothing at all.
  add column if not exists link text;

create index if not exists external_blocks_range_idx on public.external_blocks (start_date, end_date);

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at before update on public.bookings
  for each row execute function public.touch_updated_at();

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Property roots are bootstrapped here (rather than in the later tenancy
-- migration) because 02-availability builds a property-aware calendar view.
-- The detailed constraints and compatibility RPCs are installed by 05.
-- -----------------------------------------------------------------------------
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

alter table public.app_settings drop constraint if exists app_settings_id_check;
create sequence if not exists public.app_settings_id_seq;
select setval('public.app_settings_id_seq', greatest(coalesce((select max(id) from public.app_settings), 1), 1));
alter table public.app_settings alter column id set default nextval('public.app_settings_id_seq');

do $$
declare t text;
begin
  foreach t in array array[
    'app_settings', 'rate_periods', 'rate_overrides', 'bookings', 'blocked_dates',
    'open_periods', 'ical_feeds'
  ] loop
    execute format('alter table public.%I add column if not exists property_id uuid', t);
    execute format('update public.%I set property_id = public.default_property_id() where property_id is null', t);
    execute format('alter table public.%I alter column property_id set not null', t);
  end loop;
end $$;
alter table public.app_settings alter column property_id set default public.default_property_id();
