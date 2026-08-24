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
`SUPABASE_KEY` (the anon key) and `SERVICE_ROLE_KEY` in `.env`. Set `ADMIN_EMAIL`
and `ADMIN_PASSWORD` too and the `migrator` creates that back-office account for
you, which is how you get into `/admin`. Every variable is
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
5. That first checkout also keeps the card on file, and `payments:balance`
   charges the rest of the stay to it on the due date. A card authorisation
   cannot be held for more than ~7 days, so the total is never pre-authorised:
   it is two charges against the same saved card. Declines fall back to a
   payment link the host can send.

Which dates are on sale is a setting of its own: either everything except what
you block, or nothing except the ranges you open — both inside a rolling
"bookable up to N days out" window.

What a night costs is resolved in three layers, each beating the one below it:
a price typed on that day in the calendar, then the season covering it, then the
base rate plus the weekend uplift. `/admin/calendar` shows the resulting price
on every cell; nights are picked one by one or by dragging — the selection
accumulates — and then blocked, opened or edited in bulk.

Cancellation terms are refund ladders — "cancel at least N days ahead, get X%
back" — kept in `/admin/policies` with four built-ins. Every booking freezes the
policy it was sold under, so editing one, or switching to another, never changes
terms a guest already accepted. The guest reads the ladder in their own
language: only the numbers are stored, the sentences come from the locale files.

Money is stored and computed in integer cents throughout. Overlapping stays are
rejected by a Postgres exclusion constraint, not by application code, so two
guests checking out at the same moment cannot double-book.

Prices, fees, discounts, deposits and stay rules are all editable from
`/admin/settings`, `/admin/rates` and `/admin/calendar` — nothing is hard-coded.

The refundable damage deposit works the same way as the balance: with
`security_deposit_mode = card_on_file` nothing is ever held on the guest's card,
and damages are charged from the booking when there are any. A real hold was
left out on purpose — Stripe releases an authorisation after about 7 days, so
covering a stay would mean re-authorising every few days, and every renewal is
another chance for the issuer to decline while the guest watches two pending
amounts on their statement.

## Known issues

Tried to use Nuxt Content with Nuxt i18n. Spoiler alert, it
[didn't go well](https://github.com/nuxt/content/issues/2596).

To submit the updated sitemap, send this one: `/sitemap_index.xml`.
