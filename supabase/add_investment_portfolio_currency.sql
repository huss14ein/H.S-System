-- Add optional currency to investment_portfolios (USD / SAR). All holding values in this portfolio are in this currency.
-- Default NULL for existing rows; app treats NULL as USD for backwards compatibility.

alter table public.investment_portfolios
  add column if not exists currency text check (currency is null or currency in ('USD', 'SAR'));

comment on column public.investment_portfolios.currency is 'Base currency for this portfolio (holdings displayed in this currency). USD or SAR; default USD for US markets.';
