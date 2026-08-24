#!/bin/sh
# =============================================================================
# Applies supabase/db/init/*.sql in filename order.
#
# Runs as a one-shot compose job on every deploy. Every script is written to be
# idempotent (create ... if not exists / create or replace), so re-running is a
# no-op once the schema is in place.
# =============================================================================
set -eu

echo "[migrate] waiting for postgres at ${PGHOST}:${PGPORT} ..."
i=0
until pg_isready -q; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[migrate] postgres did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done

# supabase/postgres leaves its internal roles without a password, so auth, rest
# and storage cannot log in until this runs. Idempotent, and it re-syncs them
# whenever POSTGRES_PASSWORD changes.
echo "[migrate] setting the passwords of the internal Supabase roles"
psql -v ON_ERROR_STOP=1 -q -v role_password="${PGPASSWORD}" -f /roles.sql

# public.profiles has an FK to auth.users, so wait for the auth schema.
echo "[migrate] waiting for the auth schema ..."
i=0
until psql -qtAX -c "select to_regclass('auth.users') is not null" | grep -q '^t$'; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    echo "[migrate] auth.users never appeared — is the auth service healthy?" >&2
    exit 1
  fi
  sleep 2
done

for f in /sql/*.sql; do
  [ -e "$f" ] || continue
  echo "[migrate] applying $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done

# PostgREST caches the schema at start-up, so a column added above is invisible
# to the API — and to the back office — until it is told to look again. Without
# this, saving a new setting fails with "could not find the column ... in the
# schema cache" even though the migration succeeded. Done before the admin
# bootstrap so a failure there cannot skip it.
echo "[migrate] asking PostgREST to reload its schema cache"
psql -v ON_ERROR_STOP=1 -q -c "notify pgrst, 'reload schema';"

# The first back-office account. Optional: without ADMIN_EMAIL / ADMIN_PASSWORD
# the stack simply comes up with no way into /admin, and docs/DEPLOY.md explains
# how to create one by hand.
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  # The image only lays down a skeleton auth.users; GoTrue reshapes it when it
  # boots. Writing a user before that finishes fails on the missing columns, so
  # wait for the ones bootstrap-admin.sql needs.
  echo "[migrate] waiting for the GoTrue migrations ..."
  i=0
  until psql -qtAX -c "select to_regclass('auth.identities') is not null
      and exists (select 1 from information_schema.columns
                   where table_schema = 'auth' and table_name = 'users'
                     and column_name = 'email_confirmed_at')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'auth' and table_name = 'identities'
                     and column_name = 'provider_id')" | grep -q '^t$'; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "[migrate] the auth schema never finished migrating — check \`docker compose logs auth\`" >&2
      exit 1
    fi
    sleep 2
  done

  echo "[migrate] ensuring the admin account for ${ADMIN_EMAIL}"
  psql -v ON_ERROR_STOP=1 -q \
    -v admin_email="${ADMIN_EMAIL}" \
    -v admin_password="${ADMIN_PASSWORD}" \
    -v admin_password_reset="${ADMIN_PASSWORD_RESET:-false}" \
    -f /bootstrap-admin.sql
else
  echo "[migrate] ADMIN_EMAIL / ADMIN_PASSWORD unset — no admin account created"
fi

echo "[migrate] done"
