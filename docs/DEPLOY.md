# Deployment

The site used to be a static export published to GitHub Pages. It is now a Nuxt
app with a Nitro server, because the booking engine needs one: prices are
computed server-side, Stripe posts webhooks to it, the channels fetch an iCal
feed from it and `/admin` talks to Supabase through it.

Everything ships as plain Docker. Nothing here is specific to one host — it
works the same on **Dokploy**, **Dockhand**, **Coolify**, **CapRover** or a bare
`docker compose up -d` on a VPS.

---

## What runs where

| Service | Image | Public? | Purpose |
|---|---|---|---|
| `app` | built from `Dockerfile` | yes, your domain | Landing, booking engine, `/admin` |
| `kong` | `kong:2.8.1` | yes, a second subdomain | The only door into Supabase |
| `db` | `supabase/postgres` | no | Postgres 15 |
| `auth` | `supabase/gotrue` | via kong | Login for the back-office |
| `rest` | `postgrest/postgrest` | via kong | Table access under RLS |
| `storage` + `imgproxy` | `supabase/storage-api`, `darthsim/imgproxy` | via kong | File uploads |
| `meta` + `studio` | `supabase/postgres-meta`, `supabase/studio` | optional | Supabase dashboard |
| `migrator` | `postgres:15-alpine` | no | Applies `supabase/db/init/*.sql`, then exits |

`realtime`, `analytics` and the connection pooler from the upstream Supabase
compose file are deliberately left out: they add half a dozen containers and a
pile of secrets that this booking engine never uses. Add them later from the
[official compose file](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)
if you ever need them.

---

## 1. Prepare the environment

```bash
cp .env.example .env
node scripts/generate-supabase-keys.mjs >> .env
```

That writes `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`,
`DASHBOARD_PASSWORD` and `CRON_SECRET`. The two API keys are JWTs signed with
`JWT_SECRET`, so they must always be regenerated together — never mix keys from
different secrets.

Then fill in by hand:

- `SITE_URL` — where the site lives, e.g. `https://bonairepatacona.com`
- `SUPABASE_PUBLIC_URL` — where Kong lives, e.g. `https://supabase.bonairepatacona.com`
- `SMTP_*` — needed for admin password resets and invitations
- `STRIPE_*` — see step 4

## 2. Deploy

**On a PaaS (Dokploy, Dockhand, Coolify…)**

1. Create an application of type *Docker Compose* pointing at this repository.
2. Paste the contents of `.env` into the environment variables panel.
3. Set the domains: `SITE_URL` → the `app` service on port 3000,
   `SUPABASE_PUBLIC_URL` → the `kong` service on port 8000.
4. Deploy. The PaaS terminates TLS in front of both.

**On a plain VPS**

```bash
docker compose up -d --build
docker compose logs -f migrator   # should print "[migrate] done"
```

Put a reverse proxy (Caddy, Traefik, nginx) in front for TLS.

Studio is behind a `studio` compose profile and is off by default. Start it only
when you need it — `docker compose --profile studio up -d studio` — and reach it
at `SUPABASE_PUBLIC_URL`, protected by `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

**App only, against an existing Supabase**

The `Dockerfile` stands alone. Point it at Supabase Cloud or another Supabase
instance and skip the rest of the compose file:

```bash
docker build -t bonaire-landing .
docker run -p 3000:3000 --env-file .env bonaire-landing
```

## 3. Create the first administrator

`GOTRUE_DISABLE_SIGNUP=true`, so nobody can create an account from the outside.
Create the owner's account once, then promote it — new profiles default to
`viewer`, and only `admin` may write:

```bash
# Create the user (Studio → Authentication → Add user also works)
curl -X POST "$SUPABASE_PUBLIC_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@correo.com","password":"una-contrasena-larga","email_confirm":true}'

# Promote it
docker compose exec db psql -U supabase_admin -d postgres \
  -c "update public.profiles set role = 'admin' where email = 'tu@correo.com';"
```

Then sign in at `https://<tu-dominio>/admin`.

## 4. Connect Stripe

1. **API keys** — Dashboard → Developers → API keys → `STRIPE_SECRET_KEY` and
   `STRIPE_PUBLISHABLE_KEY`.
2. **Webhook** — Dashboard → Developers → Webhooks → *Add endpoint*
   `https://<tu-dominio>/api/stripe/webhook`, subscribed to:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

The webhook is the **only** thing that confirms a booking. Without it, guests
pay and their reservation stays `pending` until the hold expires — so verify the
endpoint shows deliveries in Stripe before taking real money.

Test locally with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## 5. Connect the calendars (both directions)

Go to **/admin/channels**.

*Outbound* — copy the `.ics` URL shown there and import it into:

- Airbnb → Calendar → Availability → Sync calendars → Import calendar
- Booking.com → Extranet → Rates & Availability → Calendar sync

It contains direct bookings and manual blocks, never guest names. The token in
the URL is the only thing protecting it; rotate it from the same page if it
leaks (the channels then need the new URL).

*Inbound* — add each channel's own export URL. They are pulled every 30 minutes
by the `ical:sync` scheduled task, and **Sincronizar ahora** forces a run.

A word on the gap: channel calendars refresh on their own schedule (Airbnb polls
roughly hourly), so a same-day double booking is still physically possible. The
`turnover_days` setting adds a safety margin if you want one.

## 6. Scheduled work

Nitro runs two tasks in-process (`nuxt.config.ts` → `nitro.scheduledTasks`):

| Task | Every | What it does |
|---|---|---|
| `ical:sync` | 30 min | Imports the channel calendars |
| `bookings:housekeeping` | 10 min | Releases unpaid holds, closes past stays |

If you run more than one replica, they will both fire. Either keep a single
replica, or drop `scheduledTasks` and drive `POST /api/cron/sync` from an
external scheduler instead:

```
curl -X POST https://<tu-dominio>/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
```

## 7. Backups

Everything worth keeping is in the `db-data` volume.

```bash
docker compose exec -T db pg_dump -U supabase_admin postgres | gzip > backup-$(date +%F).sql.gz
```

Uploaded files live in `storage-data`. Both should be part of whatever backup
schedule the host offers.

---

## Applying schema changes later

`supabase/db/init/*.sql` runs on every deploy through the `migrator` service and
every statement is idempotent, so editing those files and redeploying is enough
for additive changes. For anything destructive, write a one-off script and run it
yourself:

```bash
docker compose exec -T db psql -U supabase_admin -d postgres < my-change.sql
```

## Local development

```bash
cp .env.example .env            # fill SUPABASE_URL and SUPABASE_KEY
docker compose up -d db auth rest kong migrator
npm install
npm run dev
```

`npm test` runs the pricing and iCal checks without needing any of it.
