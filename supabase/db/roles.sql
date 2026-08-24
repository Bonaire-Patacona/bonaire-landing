-- =============================================================================
-- Passwords for Supabase's internal roles.
--
-- supabase/postgres creates these roles on first boot but leaves them without a
-- password, so auth, rest and storage cannot connect until someone sets one.
-- Applied by migrate.sh on every deploy, which also re-syncs them if
-- POSTGRES_PASSWORD ever changes.
--
--   psql -v role_password=... -f roles.sql
-- =============================================================================

-- Kept out of the query output on purpose: this is the database password.
select set_config('app.role_password', :'role_password', false) \g /dev/null

do $$
declare
  v_role text;
begin
  foreach v_role in array array[
    'authenticator',
    'pgbouncer',
    'supabase_auth_admin',
    'supabase_functions_admin',
    'supabase_storage_admin',
    'supabase_replication_admin',
    'supabase_read_only_user'
  ] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('alter role %I with password %L', v_role,
                     current_setting('app.role_password'));
    end if;
  end loop;
end
$$;
