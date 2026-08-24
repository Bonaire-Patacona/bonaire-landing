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
- `SUPABASE_PUBLIC_URL` — where Kong lives, e.g. `https://api.bonairepatacona.com`
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

A prebuilt image only reads the `NUXT_*` names at runtime (the plain ones are
resolved when the image is built, where `.env` is not present), so pass those:

```bash
docker build -t bonaire-landing .
docker run -p 3000:3000 --env-file .env \
  -e NUXT_PUBLIC_SITE_URL="$SITE_URL" \
  -e NUXT_PUBLIC_SUPABASE_URL="$SUPABASE_PUBLIC_URL" \
  -e NUXT_PUBLIC_SUPABASE_KEY="$ANON_KEY" \
  -e NUXT_SUPABASE_INTERNAL_URL="$SUPABASE_PUBLIC_URL" \
  -e NUXT_SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  -e NUXT_STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  -e NUXT_STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
  -e NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY" \
  bonaire-landing
```

The full mapping between the `.env` names and their `NUXT_*` aliases is listed
at the bottom of `.env.example`.

## 3. Create the first administrator

`GOTRUE_DISABLE_SIGNUP=true`, so nobody can create an account from the outside.

**The easy way — `.env`**

```
ADMIN_EMAIL=tu@correo.com
ADMIN_PASSWORD=una-contrasena-larga
```

The `migrator` picks these up on the next deploy and creates the account
already confirmed and with `role = admin` (`supabase/db/bootstrap-admin.sql`).
Re-running is a no-op: if the account already exists its password is left alone,
so changing `ADMIN_PASSWORD` later has no effect. To force it — you lost the
password, say — set `ADMIN_PASSWORD_RESET=true`, redeploy, then set it back to
`false`. Both variables empty means no account is created at all.

Watch it happen with `docker compose logs migrator`:

```
[migrate] ensuring the admin account for tu@correo.com
NOTICE:  [admin] created tu@correo.com with the admin role
```

**By hand — GoTrue's admin API**

Useful for a second account, or against a Supabase you do not control. New
profiles default to `viewer`, and only `admin` may write, so promote it after:

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
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

The webhook is the **only** thing that confirms a booking. Without it, guests
pay and their reservation stays `pending` until the hold expires — so verify the
endpoint shows deliveries in Stripe before taking real money.

Test locally with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### Collecting the balance by itself

With **Ajustes → Cobrar el resto automáticamente** on, the deposit checkout also
stores the guest's card (`setup_future_usage: off_session`) and the
`payments:balance` task charges whatever is left on `balance_due_date`.

The total is deliberately *not* pre-authorised at booking time: a card
authorisation expires after about 7 days, which is useless for a stay booked
months ahead. Two consequences worth knowing before you switch it on:

- Only cards can be charged again later, so the deposit checkout is restricted
  to cards when this is enabled (no Bizum, no bank redirects).
- An unattended charge can be declined, most often with `authentication_required`
  when the issuer insists on SCA. The booking then flips to `requires_action` or
  `failed`, a payment link is generated automatically, and it shows up on the
  booking in `/admin/bookings` for you to send. Retries run daily for
  `balance_retry_days` days first.

Say so in the cancellation policy: the guest agrees to the later charge on the
Stripe checkout page, and that text is what they will look for.

### The damage deposit

**Ajustes → Fianza** has the same two ways round: not handled by the site, or
*tarjeta guardada*. There is deliberately no "hold" option — the same 7-day
expiry applies, so holding a deposit across a stay would mean re-authorising
every few days, and each renewal can be declined while the guest sees two
pending amounts at once.

With *tarjeta guardada* nothing is blocked. If something breaks, open the
booking in `/admin/bookings` and use **Cobrar daños a la tarjeta guardada**. The
importe in Ajustes is only the figure proposed there. This also has to be
written in the cancellation policy for the charge to be legitimate.

## 5. Decide which dates are on sale

**Ajustes → Disponibilidad** has two ways round:

- **Todo abierto salvo lo que bloquee** (the default) — every day is bookable
  until a booking, a manual block or a channel event takes it.
- **Todo cerrado salvo lo que abra** — the calendar starts shut and only the
  ranges you add from **Calendario → Abrir fechas** can be booked.

Either way *Abierto hasta (días vista)* keeps a rolling window: dates further
out than that are not offered even if nothing occupies them, and the window
moves forward on its own every day.

In **Calendario** every cell shows what that night costs. Select cells — click,
drag, or shift-click — and the bar at the bottom acts on the whole run:

| Action | What it does |
|---|---|
| **Editar N noches** | Sets the price and/or the minimum stay of every selected night. Blank fields are left alone, so raising the price of forty nights does not mean retyping their minimum stay forty times. A hand-typed price beats the season and the base rate, and the weekend uplift is *not* added on top. **Volver a la tarifa** undoes it. |
| **Abrir** | Puts the nights on sale (closed-by-default mode only) |
| **Bloquear** | Takes them off the market, like an owner stay |
| **Desbloquear / Cerrar** | The reverse. A block that sticks out past the selection is trimmed, not deleted whole |

Selection accumulates and is never limited to one run: click nights one by one,
drag for whole stretches, **Shift** to extend from the last one, **Esc** (or the
× in the bar) to drop everything. Clicking a night that is already picked takes
it back out. Blocking several disjoint runs writes one row per run.

Hand-typed prices show in orange on the grid, so it is always obvious which
nights are no longer following the rate card.

## 6. Cancellation policies

**/admin/policies** holds them. A policy is a refund ladder: *cancel at least N
days before check-in and get X% of what you paid back*. The first tier the guest
still reaches wins; reaching none means no refund. Four come seeded — Flexible,
Moderada, Estricta and No reembolsable — and a deploy never overwrites one you
have edited, so treat them as yours.

One policy is the one new bookings are sold under (**Aplicar**). Two things
follow from that, and both matter:

- Every booking stores the policy **as accepted**. Changing the active policy,
  or editing an existing one, does not touch bookings already on the books.
- **Cancelar y reembolsar** in `/admin/bookings` asks the server what that
  frozen policy owes before anything moves, and shows you the figure to confirm.

Guests never read stored prose: the ladder is rendered from the locale files in
all eight languages. *Condiciones adicionales* in Ajustes, and the notes on a
policy, are the exception — they are shown verbatim, so write them in whichever
language your guests share.

Bookings that predate this feature are stamped on the first deploy with the
policy that was configured at the time, which is the one that actually applied
to them.

## 7. Connect the calendars (both directions)

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

## 8. Scheduled work

Nitro runs three tasks in-process (`nuxt.config.ts` → `nitro.scheduledTasks`):

| Task | Every | What it does |
|---|---|---|
| `ical:sync` | 30 min | Imports the channel calendars |
| `bookings:housekeeping` | 10 min | Releases unpaid holds, closes past stays |
| `payments:balance` | 1 h | Charges balances that have come due to the card on file |

If you run more than one replica, they will both fire. Either keep a single
replica, or drop `scheduledTasks` and drive `POST /api/cron/sync` from an
external scheduler instead:

```
curl -X POST https://<tu-dominio>/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
```

## 9. Backups

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
cp .env.example .env
node scripts/generate-supabase-keys.mjs >> .env
docker compose up -d db auth rest kong migrator
npm install
npm run dev
```

`npm run dev` reads `.env` directly, and the booking API needs three values from
it:

- `SUPABASE_URL` — `http://localhost:8000` (Kong, as published by compose)
- `SUPABASE_KEY` — the `ANON_KEY`, used by the browser
- `SERVICE_ROLE_KEY` — used by `server/` only; without it `/api/availability`
  answers *Supabase is not configured*

Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` as well (step 3) so the `migrator` leaves
you an account to sign in with at http://localhost:3000/admin.

Add `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` too if you want to walk
through a payment; the rest of the flow works without them.

`npm test` runs the pricing and iCal checks without needing any of it.
