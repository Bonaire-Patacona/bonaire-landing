-- =============================================================================
-- Translate the complete commercial content and track files held in Storage.
-- JSON keeps feature/review translations attached to their stable row IDs.
-- =============================================================================

alter table public.property_translations
  add column if not exists features jsonb not null default '[]'::jsonb,
  add column if not exists reviews jsonb not null default '[]'::jsonb;

alter table public.property_images
  add column if not exists storage_path text;

create unique index if not exists property_images_storage_path_idx
  on public.property_images(storage_path) where storage_path is not null;
