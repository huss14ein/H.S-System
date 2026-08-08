-- Persist broker-cash reconcile stamps on investment_transactions so UI/KPIs
-- never treat reconcile deposit/withdrawal rows as economic capital in/out.

alter table public.investment_transactions
  add column if not exists note text;

comment on column public.investment_transactions.note is
  'Optional ledger annotation. Broker-cash reconcile rows use prefix reconciliation:reconcile_balance: so capital KPIs exclude them.';

-- Backfill from reconciliation_adjustments that already linked the generated investment row.
update public.investment_transactions it
set note = left(
  'reconciliation:reconcile_balance: ' || coalesce(nullif(trim(ra.reason), ''), 'Broker cash reconcile'),
  200
)
from public.reconciliation_adjustments ra
where ra.generated_investment_transaction_id = it.id
  and ra.user_id = it.user_id
  and ra.entity_type = 'account'
  and ra.mechanism in ('reconcile_balance', 'opening_balance', 'reverse_adjustment')
  and it.type in ('deposit', 'withdrawal')
  and (it.note is null or btrim(it.note) = '');

-- Heuristic backfill when generated_investment_transaction_id was never stored:
-- match CASH deposit/withdrawal by account + date + signed amount.
update public.investment_transactions it
set note = left(
  'reconciliation:reconcile_balance: ' || coalesce(nullif(trim(ra.reason), ''), 'Broker cash reconcile'),
  200
)
from public.reconciliation_adjustments ra
where ra.generated_investment_transaction_id is null
  and ra.user_id = it.user_id
  and ra.entity_type = 'account'
  and ra.mechanism in ('reconcile_balance', 'opening_balance')
  and ra.status is distinct from 'noop'
  and it.type in ('deposit', 'withdrawal')
  and coalesce(nullif(trim(it.symbol), ''), 'CASH') = 'CASH'
  and (it.note is null or btrim(it.note) = '')
  and it.date::date = ra.effective_date::date
  and (
    (ra.account_id is not null and it.account_id = ra.account_id)
    or it.account_id = ra.entity_id
  )
  and (
    (ra.delta < 0 and it.type = 'withdrawal')
    or (ra.delta > 0 and it.type = 'deposit')
  )
  and abs(it.total - abs(ra.delta)) < 0.02;
