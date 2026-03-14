-- Optional migration: store gold purity per commodity holding.
-- App supports symbol-encoded purity without this column,
-- but adding it keeps purity explicit in DB and easier to query.

alter table if exists public.commodity_holdings
  add column if not exists gold_karat integer;

-- Keep allowed karat values only.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'commodity_holdings_gold_karat_check'
  ) then
    alter table public.commodity_holdings
      add constraint commodity_holdings_gold_karat_check
      check (gold_karat is null or gold_karat in (24,22,21,18));
  end if;
end $$;
