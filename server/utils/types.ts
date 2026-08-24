export interface AppSettings {
  id: number
  property_name: string
  contact_email: string | null
  currency: string
  base_nightly_cents: number
  weekend_uplift_pct: number
  cleaning_fee_cents: number
  tax_pct: number
  guests_included: number
  extra_guest_fee_cents: number
  max_guests: number
  min_nights: number
  max_nights: number
  advance_notice_days: number
  booking_window_days: number
  turnover_days: number
  checkin_time: string
  checkout_time: string
  weekly_discount_pct: number
  monthly_discount_pct: number
  deposit_type: 'percent' | 'fixed' | 'full'
  deposit_percent: number
  deposit_fixed_cents: number
  balance_due_days_before: number
  security_deposit_cents: number
  hold_minutes: number
  cancellation_policy: string
  ical_export_token: string
  updated_at: string
}

export interface RatePeriod {
  id: string
  name: string
  start_date: string
  end_date: string
  nightly_cents: number
  min_nights: number | null
  weekend_uplift_pct: number | null
  priority: number
  active: boolean
}

export interface NightPrice {
  date: string
  cents: number
  weekend: boolean
  rate_period: string | null
}

export interface Quote {
  currency: string
  check_in: string
  check_out: string
  nights: number
  guests: number
  adults: number
  children: number
  breakdown: NightPrice[]
  nightly_subtotal_cents: number
  extra_guest_cents: number
  cleaning_fee_cents: number
  discount_cents: number
  discount_label: 'weekly' | 'monthly' | null
  discount_pct: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  balance_cents: number
  balance_due_date: string | null
  security_deposit_cents: number
  min_nights: number
  checkin_time: string
  checkout_time: string
  cancellation_policy: string
}

export interface BookingRow {
  id: string
  reference: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'completed'
  source: string
  check_in: string
  check_out: string
  adults: number
  children: number
  guest_name: string
  guest_email: string
  guest_phone: string | null
  guest_country: string | null
  locale: string
  notes: string | null
  currency: string
  nightly_subtotal_cents: number
  cleaning_fee_cents: number
  extra_guest_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  balance_cents: number
  amount_paid_cents: number
  security_deposit_cents: number
  price_breakdown: NightPrice[]
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_customer_id: string | null
  balance_payment_url: string | null
  balance_due_date: string | null
  hold_expires_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
}
