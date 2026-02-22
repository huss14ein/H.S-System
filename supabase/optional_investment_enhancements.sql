begin;

-- Optional schema enhancements for investment analytics.
-- Safe to run multiple times.

alter table if exists public.planned_trades
  add column if not exists planned_entry_price numeric,
  add column if not exists planned_exit_price numeric,
  add column if not exists stop_loss_price numeric,
  add column if not exists take_profit_price numeric,
  add column if not exists strategy_tag text,
  add column if not exists confidence_score numeric;

alter table if exists public.planned_trades
  drop constraint if exists planned_trades_confidence_score_check;

alter table if exists public.planned_trades
  add constraint planned_trades_confidence_score_check
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100));

-- Backfill planned_entry_price using whichever column naming variant exists.
do $$
declare
  condition_col text;
  target_col text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'conditionType'
  ) then
    condition_col := '"conditionType"';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'condition_type'
  ) then
    condition_col := 'condition_type';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'conditiontype'
  ) then
    condition_col := 'conditiontype';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'targetValue'
  ) then
    target_col := '"targetValue"';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'target_value'
  ) then
    target_col := 'target_value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planned_trades' and column_name = 'targetvalue'
  ) then
    target_col := 'targetvalue';
  end if;

  if condition_col is not null and target_col is not null then
    execute format(
      'update public.planned_trades
       set planned_entry_price = case
         when planned_entry_price is not null then planned_entry_price
         when coalesce(quantity, 0) > 0 and coalesce(amount, 0) > 0 then amount / quantity
         when %s = ''price'' then %s
         else null
       end',
      condition_col,
      target_col
    );
  else
    update public.planned_trades
    set planned_entry_price = case
      when planned_entry_price is not null then planned_entry_price
      when coalesce(quantity, 0) > 0 and coalesce(amount, 0) > 0 then amount / quantity
      else null
    end;
  end if;
end $$;

create table if not exists public.trade_execution_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  planned_trade_id uuid null references public.planned_trades(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  planned_price numeric,
  executed_price numeric not null,
  executed_quantity numeric not null check (executed_quantity > 0),
  executed_at timestamptz not null default now(),
  execution_note text
);

-- If the table already exists from an older migration, ensure required columns are present.
alter table if exists public.trade_execution_audit
  add column if not exists user_id uuid,
  add column if not exists planned_trade_id uuid,
  add column if not exists symbol text,
  add column if not exists side text,
  add column if not exists planned_price numeric,
  add column if not exists executed_price numeric,
  add column if not exists executed_quantity numeric,
  add column if not exists executed_at timestamptz,
  add column if not exists execution_note text;

update public.trade_execution_audit
set executed_at = now()
where executed_at is null;

alter table if exists public.trade_execution_audit
  alter column executed_at set default now();

alter table if exists public.trade_execution_audit
  alter column executed_at set not null;

create index if not exists idx_planned_trades_user_status
  on public.planned_trades(user_id, status);

create index if not exists idx_planned_trades_user_symbol
  on public.planned_trades(user_id, symbol);

create index if not exists idx_price_alerts_user_symbol_status
  on public.price_alerts(user_id, symbol, status);

create index if not exists idx_execution_audit_user_time
  on public.trade_execution_audit(user_id, executed_at desc);

create or replace view public.v_investment_signal_summary as
select
  pt.user_id,
  count(*) as planned_count,
  count(*) filter (where lower(coalesce(pt.status, '')) = 'executed') as executed_count,
  count(*) filter (where lower(coalesce(pt.status, '')) in ('planned', 'triggered')) as open_count,
  avg(case
    when tea.planned_price is null or tea.planned_price = 0 then null
    else ((tea.executed_price - tea.planned_price) / tea.planned_price) * 100
  end) as avg_slippage_pct
from public.planned_trades pt
left join public.trade_execution_audit tea
  on tea.planned_trade_id = pt.id
group by pt.user_id;

commit;
