-- =============================================================================
-- Optional starting data. Tweak everything later from /admin/settings.
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
       cancellation_policy    = 'Cancelacion gratuita hasta 14 dias antes de la llegada. Despues, el deposito no es reembolsable.'
 where id = 1;

insert into public.rate_periods (name, start_date, end_date, nightly_cents, min_nights, priority)
select * from (values
  ('Temporada alta 2026',  date '2026-06-15', date '2026-09-15', 16500, 5, 20),
  ('Fallas 2027',          date '2027-03-12', date '2027-03-20', 19000, 3, 30),
  ('Semana Santa 2027',    date '2027-03-25', date '2027-04-05', 14000, 4, 25)
) as v(name, start_date, end_date, nightly_cents, min_nights, priority)
where not exists (select 1 from public.rate_periods);
