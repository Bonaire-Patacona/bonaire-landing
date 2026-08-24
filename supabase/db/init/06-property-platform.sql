-- =============================================================================
-- Property catalogue: commercial content and per-property policy assignments.
-- Cancellation policies are reusable platform templates; assignments belong
-- to properties and may be the default or apply to a seasonal date range.
-- =============================================================================

-- Undo the short-lived per-property policy model on installations that already
-- received 05 before this platform split.
delete from public.cancellation_policies p
using (
  select id, row_number() over (partition by code order by builtin desc, created_at, id) as position
  from public.cancellation_policies
) duplicate
where p.id = duplicate.id and duplicate.position > 1;

drop index if exists public.cancellation_policies_property_code_idx;
drop index if exists public.cancellation_policies_property_idx;
alter table public.cancellation_policies drop constraint if exists cancellation_policies_property_id_fkey;
alter table public.cancellation_policies alter column property_id drop not null;
alter table public.cancellation_policies alter column property_id drop default;
update public.cancellation_policies set property_id = null where property_id is not null;
create unique index if not exists cancellation_policies_code_idx on public.cancellation_policies (code);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_cancellation_policy_fkey') then
    alter table public.app_settings add constraint app_settings_cancellation_policy_fkey
      foreign key (cancellation_policy_code) references public.cancellation_policies(code)
      on update cascade on delete restrict;
  end if;
end $$;

alter table public.properties
  add column if not exists short_description text not null default '',
  add column if not exists description text not null default '',
  add column if not exists address text not null default '',
  add column if not exists city text not null default '',
  add column if not exists country text not null default '',
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7),
  add column if not exists bedrooms integer not null default 1 check (bedrooms >= 0),
  add column if not exists bathrooms numeric(4,1) not null default 1 check (bathrooms >= 0),
  add column if not exists beds integer not null default 1 check (beds >= 0),
  add column if not exists floor_area_m2 integer check (floor_area_m2 >= 0),
  add column if not exists licence_number text,
  add column if not exists published boolean not null default false;

create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  url text not null,
  alt text not null default '',
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists property_images_one_cover_idx
  on public.property_images(property_id) where is_cover;
create index if not exists property_images_order_idx on public.property_images(property_id, sort_order);

create table if not exists public.property_features (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default 'i-lucide-circle-check',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists property_features_order_idx on public.property_features(property_id, sort_order);

create table if not exists public.property_reviews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  author text not null,
  quote text not null,
  rating numeric(2,1) not null default 5 check (rating between 0 and 5),
  source text not null default 'direct',
  reviewed_at date,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists property_reviews_order_idx on public.property_reviews(property_id, sort_order);

create table if not exists public.property_policy_periods (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  policy_id uuid not null references public.cancellation_policies(id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  constraint property_policy_periods_range_valid check (end_date >= start_date)
);
create index if not exists property_policy_periods_lookup_idx
  on public.property_policy_periods(property_id, start_date, end_date, priority desc);

alter table public.property_images enable row level security;
alter table public.property_features enable row level security;
alter table public.property_reviews enable row level security;
alter table public.property_policy_periods enable row level security;

do $$
declare t text;
begin
  foreach t in array array['property_images','property_features','property_reviews','property_policy_periods'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
