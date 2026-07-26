-- Allow bonus / stock_dividend corporate actions (additive check-constraint widen).
-- Live-data safe: drop + recreate CHECK only; no table rebuild, no row mutation.

begin;

alter table public.corporate_action_events
  drop constraint if exists corporate_action_events_action_type_check;

alter table public.corporate_action_events
  add constraint corporate_action_events_action_type_check
  check (action_type in (
    'stock_split',
    'reverse_stock_split',
    'cash_in_lieu',
    'spinoff',
    'merger',
    'dividend_cash',
    'dividend_drip',
    'stock_dividend'
  ));

commit;
