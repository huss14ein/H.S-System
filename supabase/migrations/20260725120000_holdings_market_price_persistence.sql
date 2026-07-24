-- Persist the latest trusted provider price and book-currency market value.
-- Safe for live data: adds nullable columns; does not delete or rebuild tables.
--
-- The RPC updates ONLY market columns. It cannot alter quantity, avg_cost,
-- realized_pnl, ownership, or portfolio placement.

alter table public.holdings
  add column if not exists current_price numeric null,
  add column if not exists price_updated_at timestamptz null;

comment on column public.holdings.current_price is
  'Latest trusted provider unit price in the symbol quote currency.';
comment on column public.holdings.price_updated_at is
  'Timestamp of the trusted quote used for current_price/current_value.';

create index if not exists idx_holdings_price_updated_at
  on public.holdings (user_id, price_updated_at desc);

create or replace function public.update_holding_market_values(p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'p_updates must be a JSON array';
  end if;

  update public.holdings as h
  set
    current_value = u.current_value,
    current_price = u.current_price,
    price_updated_at = u.price_updated_at
  from jsonb_to_recordset(p_updates) as u(
    id uuid,
    current_value numeric,
    current_price numeric,
    price_updated_at timestamptz
  )
  where h.id = u.id
    and h.user_id = auth.uid()
    and u.current_value > 0
    and u.current_price > 0
    and u.price_updated_at is not null
    -- A delayed older refresh must never overwrite a newer trusted quote.
    and (h.price_updated_at is null or h.price_updated_at <= u.price_updated_at);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.update_holding_market_values(jsonb) from public;
grant execute on function public.update_holding_market_values(jsonb) to authenticated;
