-- =============================================================================
-- When a pending transaction is approved, record it in budget_shared_transactions
-- so that get_shared_budget_consumed_for_me and shared transaction lists reflect
-- the deduction for all users with access to that budget.
-- Run after multi_user_governance.sql and after budget_shares / budget_shared_transactions exist.
-- =============================================================================

create or replace function public.approve_pending_transaction(p_transaction_id uuid)
returns void
language plpgsql
as $$
declare
  tx record;
  tx_json jsonb;
  tx_status text;
  tx_amount numeric;
  budget_category_name text;
  share_rec record;
begin
  select *
  into tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction % not found', p_transaction_id;
  end if;

  tx_json := to_jsonb(tx);
  tx_status := coalesce(tx_json->>'status', 'Approved');
  tx_amount := nullif(tx_json->>'amount', '')::numeric;
  budget_category_name := coalesce(tx_json->>'budgetCategory', tx_json->>'budget_category');

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Approved'
  where id = p_transaction_id;

  if budget_category_name is not null and tx_amount is not null then
    update public.categories
    set total_spent = coalesce(total_spent, 0) + abs(tx_amount)
    where name = budget_category_name;
  end if;

  -- Record in budget_shared_transactions for each owner who shared this category with the transaction owner (contributor)
  if budget_category_name is not null and tx_amount is not null and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'budget_shares') and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'budget_shared_transactions') then
    for share_rec in
      select bs.owner_user_id
      from public.budget_shares bs
      where bs.shared_with_user_id = tx.user_id
        and (bs.category is null or bs.category = budget_category_name)
    loop
      insert into public.budget_shared_transactions (
        owner_user_id,
        contributor_user_id,
        source_transaction_id,
        transaction_date,
        amount,
        budget_category,
        description,
        status
      )
      values (
        share_rec.owner_user_id,
        tx.user_id,
        p_transaction_id,
        coalesce((tx_json->>'date')::date, current_date),
        abs(tx_amount),
        budget_category_name,
        coalesce(tx_json->>'description', ''),
        'Approved'
      );
    end loop;
  end if;
end;
$$;
