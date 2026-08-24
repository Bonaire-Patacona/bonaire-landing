# Bonaire Patacona

Landing site and direct-booking engine for the Bonaire Patacona apartment
(La Patacona, Alboraia, Valencia).

Nuxt 4 + Nuxt UI on the front, a Nitro server for the booking logic, and a
self-hosted Supabase (Postgres + Auth + PostgREST + Storage) behind it. Payments
go through Stripe; availability is kept in sync with Airbnb and Booking.com over
iCal in both directions.

## Getting started

```bash
npm install
cp .env.example .env
node scripts/generate-supabase-keys.mjs >> .env   # JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY…
docker compose up -d db auth rest kong migrator
npm run dev
```

The booking API needs `SUPABASE_URL` (the local Kong, `http://localhost:8000`),
`SUPABASE_KEY` (the anon key) and `SERVICE_ROLE_KEY` in `.env`. Every variable is
documented in `.env.example`, including how each one maps to the `NUXT_*` name
that overrides it at runtime in Docker.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build (`.output/`) |
| `npm start` | Runs the production build |
| `npm test` | Pricing + iCal checks (no database, no network) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `vue-tsc` |

The Supabase stack is in `docker-compose.yml`; see **[docs/DEPLOY.md](docs/DEPLOY.md)**
for the full setup, including how to create the first administrator and connect
Stripe and the channel calendars.

## Layout

```
app/                     Pages, components, layouts, admin panel
  pages/reservar.vue       Public booking flow
  pages/reserva/[ref]      Guest confirmation page
  pages/admin/             Back-office (dashboard, bookings, calendar,
                           rates, channels, settings)
server/
  api/                     Public + admin HTTP endpoints, Stripe webhook, iCal feed
  utils/pricing.ts         The pricing engine
  utils/ical.ts            iCalendar reader/writer
  tasks/                   Scheduled iCal sync and booking housekeeping
supabase/db/init/        Schema, availability functions, RLS, seed data
test/                    Booking engine checks
docs/DEPLOY.md           Deployment guide
```

## How the booking engine works

1. `/api/availability` publishes which nights are free and what each costs.
2. `/api/quote` prices a candidate stay and validates it against the house rules
   (minimum stay, notice, party size).
3. `POST /api/bookings` writes a `pending` booking, holds the dates for a
   configurable number of minutes and opens a Stripe Checkout session for the
   deposit.
4. The Stripe webhook is the only thing that promotes a booking to `confirmed`.
   Unpaid holds are released automatically.

Money is stored and computed in integer cents throughout. Overlapping stays are
rejected by a Postgres exclusion constraint, not by application code, so two
guests checking out at the same moment cannot double-book.

Prices, fees, discounts, deposits and stay rules are all editable from
`/admin/settings` and `/admin/rates` — nothing is hard-coded.

## Known issues

Tried to use Nuxt Content with Nuxt i18n. Spoiler alert, it
[didn't go well](https://github.com/nuxt/content/issues/2596).

To submit the updated sitemap, send this one: `/sitemap_index.xml`.
