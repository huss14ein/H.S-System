-- Dividend plan fields on holdings (persist expected plan per user/holding).

alter table if exists public.holdings
  add column if not exists dividend_yield numeric,
  add column if not exists dividend_distribution text,
  add column if not exists expected_annual_dividend_sar numeric,
  add column if not exists dividend_payout_cadence text,
  add column if not exists typical_payout_months integer[];

comment on column public.holdings.expected_annual_dividend_sar is 'User/plan expected annual dividend cash in SAR equivalent for this holding.';
comment on column public.holdings.dividend_payout_cadence is 'none | monthly | quarterly | annual | reinvest';
comment on column public.holdings.typical_payout_months is 'Calendar months (1-12) when dividends usually pay, inferred from ledger or set by user.';

alter table if exists public.holdings
  drop constraint if exists holdings_dividend_distribution_check;

alter table if exists public.holdings
  add constraint holdings_dividend_distribution_check
  check (dividend_distribution is null or dividend_distribution in ('Reinvest', 'Payout'));

alter table if exists public.holdings
  drop constraint if exists holdings_dividend_payout_cadence_check;

alter table if exists public.holdings
  add constraint holdings_dividend_payout_cadence_check
  check (
    dividend_payout_cadence is null
    or dividend_payout_cadence in ('none', 'monthly', 'quarterly', 'annual', 'reinvest')
  );
