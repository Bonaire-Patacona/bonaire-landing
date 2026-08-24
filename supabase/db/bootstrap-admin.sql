-- =============================================================================
-- First back-office account, taken from ADMIN_EMAIL / ADMIN_PASSWORD.
--
-- Deliberately outside supabase/db/init/, because migrate.sh only applies this
-- when both variables are set and passes them in as psql variables:
--
--   psql -v admin_email=... -v admin_password=... -v admin_password_reset=false \
--        -f bootstrap-admin.sql
--
-- Sign-up is disabled in GoTrue, so this (or the manual curl in docs/DEPLOY.md)
-- is the only way in. Re-running is a no-op: an existing account keeps its
-- password unless ADMIN_PASSWORD_RESET is true.
-- =============================================================================

-- psql does not interpolate :variables inside dollar-quoted bodies, so the
-- values are parked in session settings the DO block can read back. The output
-- is discarded so the password never reaches the migrator logs.
select set_config('app.admin_email', :'admin_email', false),
       set_config('app.admin_password', :'admin_password', false),
       set_config('app.admin_password_reset', :'admin_password_reset', false)
\g /dev/null

-- crypt() and gen_salt() live in the extensions schema on supabase/postgres.
set search_path to public, extensions;

do $$
declare
  v_email    text := lower(trim(coalesce(current_setting('app.admin_email', true), '')));
  v_password text := coalesce(current_setting('app.admin_password', true), '');
  v_reset    boolean := lower(coalesce(current_setting('app.admin_password_reset', true), 'false'))
                        in ('true', '1', 'yes');
  v_id       uuid;
  v_created  boolean := false;
begin
  if v_email = '' or v_password = '' then
    raise notice '[admin] ADMIN_EMAIL / ADMIN_PASSWORD are empty — nothing to do';
    return;
  end if;

  if length(v_password) < 8 then
    raise exception '[admin] ADMIN_PASSWORD must be at least 8 characters';
  end if;

  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      -- GoTrue reads these as plain strings; NULL makes it fail at sign-in.
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token,
      reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );
    v_created := true;
  elsif v_reset then
    update auth.users
       set encrypted_password = crypt(v_password, gen_salt('bf', 10)),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_id;
  end if;

  -- Password sign-in expects an email identity next to the user row.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  )
  select gen_random_uuid(), v_id, v_id::text, 'email',
         jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
         now(), now(), now()
  where not exists (
    select 1 from auth.identities where user_id = v_id and provider = 'email'
  );

  -- on_auth_user_created already inserted a 'viewer' profile; promote it.
  insert into public.profiles (id, email, role)
  values (v_id, v_email, 'admin')
  on conflict (id) do update set role = 'admin', email = excluded.email;

  if v_created then
    raise notice '[admin] created % with the admin role', v_email;
  elsif v_reset then
    raise notice '[admin] % already existed — password reset, admin role ensured', v_email;
  else
    raise notice '[admin] % already exists — admin role ensured, password untouched', v_email;
  end if;
end
$$;
