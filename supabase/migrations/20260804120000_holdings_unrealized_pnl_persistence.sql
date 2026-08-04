-- Persist unrealized P/L alongside trusted unit price / market value.
-- Safe for live data: nullable column; market RPC only (never quantity / avg_cost / realized_pnl).

alter table public.holdings
  add column if not exists unrealized_pnl numeric null;

comment on column public.holdings.unrealized_pnl is
  'Unrealized P/L in portfolio book currency: current_value − (quantity × avg_cost), stamped with last trusted mark.';

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
    price_updated_at = u.price_updated_at,
    unrealized_pnl = coalesce(u.unrealized_pnl, u.current_value - (h.quantity * h.avg_cost))
  from jsonb_to_recordset(p_updates) as u(
    id uuid,
    current_value numeric,
    current_price numeric,
    price_updated_at timestamptz,
    unrealized_pnl numeric
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
