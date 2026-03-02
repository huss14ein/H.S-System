-- Fix investment account foreign keys (non-destructive, idempotent where possible).
-- Use this if you see:
--   insert/update on table "investment_transactions" violates foreign key constraint ...accountId... (23503)
-- because investment transactions/portfolios reference an account id that doesn't exist in public.accounts.
--
-- This script:
-- - Ensures snake_case `account_id` columns exist on investment tables
-- - Backfills from camelCase `accountId` when present
-- - Adds FK constraints to public.accounts(id)
-- - Optionally removes orphan rows (commented; enable if you want cleanup)
--
-- Run in Supabase SQL editor. Safe to re-run.

do $$
begin
  -- 1) investment_transactions.account_id (uuid) + backfill from accountId
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='investment_transactions') then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='investment_transactions' and column_name='account_id'
    ) then
      alter table public.investment_transactions add column account_id uuid;
    end if;

    -- Backfill from camelCase if it exists and account_id is null
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='investment_transactions' and column_name='accountId'
    ) then
      begin
        execute $sql$
          update public.investment_transactions
          set account_id = nullif("accountId",'')::uuid
          where account_id is null and "accountId" is not null and "accountId" <> ''
        $sql$;
      exception when others then
        -- If casting fails for some rows, leave them for manual cleanup.
        raise notice 'Could not fully backfill investment_transactions.account_id from "accountId" (cast failed on some rows).';
      end;
    end if;

    -- Add FK if missing
    if not exists (select 1 from pg_constraint where conname = 'investment_transactions_account_id_fkey') then
      begin
        alter table public.investment_transactions
          add constraint investment_transactions_account_id_fkey
          foreign key (account_id) references public.accounts(id) on delete restrict;
      exception when others then
        raise notice 'Could not add FK investment_transactions_account_id_fkey (check existing schema/constraints).';
      end;
    end if;

    create index if not exists idx_investment_transactions_account_id on public.investment_transactions(account_id);
  end if;

  -- 2) investment_portfolios.account_id (uuid) + backfill from accountId
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='investment_portfolios') then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='investment_portfolios' and column_name='account_id'
    ) then
      alter table public.investment_portfolios add column account_id uuid;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='investment_portfolios' and column_name='accountId'
    ) then
      begin
        execute $sql$
          update public.investment_portfolios
          set account_id = nullif("accountId",'')::uuid
          where account_id is null and "accountId" is not null and "accountId" <> ''
        $sql$;
      exception when others then
        raise notice 'Could not fully backfill investment_portfolios.account_id from "accountId" (cast failed on some rows).';
      end;
    end if;

    if not exists (select 1 from pg_constraint where conname = 'investment_portfolios_account_id_fkey') then
      begin
        alter table public.investment_portfolios
          add constraint investment_portfolios_account_id_fkey
          foreign key (account_id) references public.accounts(id) on delete restrict;
      exception when others then
        raise notice 'Could not add FK investment_portfolios_account_id_fkey (check existing schema/constraints).';
      end;
    end if;

    create index if not exists idx_investment_portfolios_account_id on public.investment_portfolios(account_id);
  end if;
end $$;

-- 3) Optional cleanup (enable if you want to remove broken/orphan rows)
-- WARNING: This deletes data. Uncomment intentionally.
--
-- -- Delete orphan investment transactions
-- delete from public.investment_transactions it
-- where it.account_id is null
--    or not exists (select 1 from public.accounts a where a.id = it.account_id);
--
-- -- Delete orphan portfolios (rare; usually you want to fix account_id instead)
-- delete from public.investment_portfolios p
-- where p.account_id is null
--    or not exists (select 1 from public.accounts a where a.id = p.account_id);

