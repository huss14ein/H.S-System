-- Add optional currency column to price_alerts (USD or SAR for target price).
alter table if exists public.price_alerts
  add column if not exists currency text;

comment on column public.price_alerts.currency is 'Currency of target_price: USD or SAR. Optional; defaults to app display.';
