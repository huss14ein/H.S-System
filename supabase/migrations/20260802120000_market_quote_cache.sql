-- Durable per-user market quote cache (manual refresh only — reduces provider API reuse).
-- Additive / live-data safe: create-if-not-exists only (never drop or wipe tables).

create table if not exists public.market_quote_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  price numeric not null check (price > 0),
  change numeric not null default 0,
  change_percent numeric not null default 0,
  fetched_at timestamptz not null,
  primary key (user_id, symbol)
);

comment on table public.market_quote_cache is
  'Last trusted live quotes from a user-initiated refresh (Header Sync / Investments). Seeds the client cache on hydrate so APIs are not re-hit automatically.';

create index if not exists idx_market_quote_cache_fetched_at
  on public.market_quote_cache (user_id, fetched_at desc);

alter table public.market_quote_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_quote_cache'
      and policyname = 'Users can manage own market_quote_cache'
  ) then
    create policy "Users can manage own market_quote_cache"
      on public.market_quote_cache
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.upsert_market_quote_cache(p_rows jsonb)
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

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.market_quote_cache as c (
    user_id, symbol, price, change, change_percent, fetched_at
  )
  select
    auth.uid(),
    upper(trim(u.symbol)),
    u.price,
    coalesce(u.change, 0),
    coalesce(u.change_percent, 0),
    u.fetched_at
  from jsonb_to_recordset(p_rows) as u(
    symbol text,
    price numeric,
    change numeric,
    change_percent numeric,
    fetched_at timestamptz
  )
  where u.symbol is not null
    and length(trim(u.symbol)) > 0
    and u.price is not null
    and u.price > 0
    and u.fetched_at is not null
  on conflict (user_id, symbol) do update
    set
      price = excluded.price,
      change = excluded.change,
      change_percent = excluded.change_percent,
      fetched_at = excluded.fetched_at
    where c.fetched_at is null
       or c.fetched_at <= excluded.fetched_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.upsert_market_quote_cache(jsonb) from public;
grant execute on function public.upsert_market_quote_cache(jsonb) to authenticated;
