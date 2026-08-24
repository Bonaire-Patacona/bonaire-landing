-- =============================================================================
-- AI-assisted, manually overridable property translations.
-- The columns on properties remain the canonical source text. This table only
-- stores target-language variants, so existing integrations keep working.
-- =============================================================================

alter table public.properties
  add column if not exists source_locale text not null default 'es';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_source_locale_valid') then
    alter table public.properties add constraint properties_source_locale_valid
      check (source_locale in ('en', 'es', 'ca', 'fr', 'de', 'it', 'nl', 'sv'));
  end if;
end $$;

create table if not exists public.property_translations (
  property_id uuid not null references public.properties(id) on delete cascade,
  locale text not null check (locale in ('en', 'es', 'ca', 'fr', 'de', 'it', 'nl', 'sv')),
  name text not null default '',
  short_description text not null default '',
  description text not null default '',
  origin text not null default 'ai' check (origin in ('ai', 'manual')),
  source_hash text not null,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, locale)
);

create index if not exists property_translations_locale_idx
  on public.property_translations(locale, property_id);

alter table public.property_translations enable row level security;
drop policy if exists property_translations_admin_all on public.property_translations;
create policy property_translations_admin_all on public.property_translations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.property_translations to authenticated;
grant all on public.property_translations to service_role;
