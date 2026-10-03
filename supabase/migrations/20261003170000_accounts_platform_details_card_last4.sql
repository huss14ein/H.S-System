-- Persist Card / account last-4 for SMS import routing on accounts.platform_details.
-- Idempotent: safe if the column already exists.

alter table if exists public.accounts
  add column if not exists platform_details jsonb;

comment on column public.accounts.platform_details is
  'JSON metadata for cash accounts (features, assetTypes, fees, cardLast4). cardLast4 mirrors Account.lastFourDigits for SMS auto-routing.';
