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

# GoTrue creates the auth schema on its own first boot; public.profiles has an
# FK to auth.users, so wait for it before applying anything.
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

echo "[migrate] done"
