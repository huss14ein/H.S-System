-- Correct ambiguous heuristic reconcile note stamps from 20260808194430.
-- Runtime stamp is 1:1 only; this migration undoes multi-row mis-tags and re-applies safely.

-- 1) Clear reconcile notes that are NOT linked via generated_investment_transaction_id
--    (those came from the heuristic backfill and may have stamped peer capital rows).
update public.investment_transactions it
set note = null
where it.note is not null
  and it.note like 'reconciliation:reconcile_balance:%'
  and not exists (
    select 1
    from public.reconciliation_adjustments ra
    where ra.generated_investment_transaction_id = it.id
      and ra.user_id = it.user_id
  );

-- 2) Re-apply linked stamps (authoritative).
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

-- 3) Heuristic re-stamp only when fingerprint is unambiguous:
--    exactly one unlinked adjustment and exactly one CASH deposit/withdrawal
--    for the same user + account + date + type + amount (±0.02).
with adj as (
  select
    ra.id as adj_id,
    ra.user_id,
    ra.reason,
    ra.effective_date::date as eff_date,
    coalesce(ra.account_id, ra.entity_id) as acct_id,
    case when ra.delta < 0 then 'withdrawal' else 'deposit' end as tx_type,
    abs(ra.delta) as abs_delta,
    round(abs(ra.delta) * 100) as amount_cents
  from public.reconciliation_adjustments ra
  where ra.generated_investment_transaction_id is null
    and ra.entity_type = 'account'
    and ra.mechanism in ('reconcile_balance', 'opening_balance')
    and ra.status is distinct from 'noop'
    and ra.status is distinct from 'reversed'
    and ra.reversed_by_adjustment_id is null
    and abs(ra.delta) >= 1e-9
),
adj_unique as (
  select a.*
  from adj a
  where (
    select count(*)
    from adj b
    where b.user_id = a.user_id
      and b.acct_id = a.acct_id
      and b.eff_date = a.eff_date
      and b.tx_type = a.tx_type
      and b.amount_cents = a.amount_cents
  ) = 1
),
tx_cand as (
  select
    it.id as tx_id,
    it.user_id,
    it.account_id,
    it.date::date as tx_date,
    it.type as tx_type,
    round(abs(it.total) * 100) as amount_cents,
    abs(it.total) as abs_total
  from public.investment_transactions it
  where it.type in ('deposit', 'withdrawal')
    and coalesce(nullif(trim(it.symbol), ''), 'CASH') = 'CASH'
    and (it.note is null or btrim(it.note) = '')
),
tx_unique as (
  select t.*
  from tx_cand t
  where (
    select count(*)
    from tx_cand u
    where u.user_id = t.user_id
      and u.account_id = t.account_id
      and u.tx_date = t.tx_date
      and u.tx_type = t.tx_type
      and u.amount_cents = t.amount_cents
  ) = 1
),
matched as (
  select
    t.tx_id,
    left(
      'reconciliation:reconcile_balance: ' || coalesce(nullif(trim(a.reason), ''), 'Broker cash reconcile'),
      200
    ) as note
  from tx_unique t
  join adj_unique a
    on a.user_id = t.user_id
   and a.acct_id = t.account_id
   and a.eff_date = t.tx_date
   and a.tx_type = t.tx_type
   and abs(a.abs_delta - t.abs_total) < 0.02
)
update public.investment_transactions it
set note = m.note
from matched m
where it.id = m.tx_id;
