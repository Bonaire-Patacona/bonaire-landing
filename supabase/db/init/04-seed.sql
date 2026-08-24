-- =============================================================================
-- Optional starting data. Tweak everything later from /admin/settings.
--
-- This runs on every deploy, so it must only ever touch a settings row nobody
-- has configured yet: the guard below matches the factory defaults from
-- 01-app-schema.sql. Without it, a redeploy would quietly reset the host's
-- prices, fees and deposit rules back to these demo values.
-- =============================================================================

update public.app_settings
   set property_name          = 'Bonaire Patacona',
       contact_email          = 'hola@bonairepatacona.com',
       currency               = 'EUR',
       base_nightly_cents     = 9500,
       weekend_uplift_pct     = 10,
       cleaning_fee_cents     = 5000,
       tax_pct                = 0,
       guests_included        = 2,
       extra_guest_fee_cents  = 1500,
       max_guests             = 4,
       min_nights             = 2,
       max_nights             = 30,
       advance_notice_days    = 1,
       booking_window_days    = 540,
       checkin_time           = '16:00',
       checkout_time          = '11:00',
       weekly_discount_pct    = 5,
       monthly_discount_pct   = 15,
       deposit_type           = 'percent',
       deposit_percent        = 30,
       balance_due_days_before = 14,
       security_deposit_cents = 20000,
       hold_minutes           = 30,
       -- The refund ladder itself now lives in public.cancellation_policies and
       -- is rendered in the guest's language; this field is only the addendum
       -- underneath it, so it must not restate the tiers.
       cancellation_policy    = 'Los gastos de gestion de la pasarela de pago no son reembolsables.'
 where id = 1
   and contact_email is null
   and base_nightly_cents = 9000
   and cleaning_fee_cents = 4500;

insert into public.rate_periods (name, start_date, end_date, nightly_cents, min_nights, priority)
select * from (values
  ('Temporada alta 2026',  date '2026-06-15', date '2026-09-15', 16500, 5, 20),
  ('Fallas 2027',          date '2027-03-12', date '2027-03-20', 19000, 3, 30),
  ('Semana Santa 2027',    date '2027-03-25', date '2027-04-05', 14000, 4, 25)
) as v(name, start_date, end_date, nightly_cents, min_nights, priority)
where not exists (select 1 from public.rate_periods);
