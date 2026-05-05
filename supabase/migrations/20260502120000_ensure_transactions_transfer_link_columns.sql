-- Idempotent: databases that missed 20260328091000_add_linked_transfer_rpc.sql fail RPCs with 42703 on transfer_group_id.

alter table if exists public.transactions
  add column if not exists transfer_group_id uuid,
  add column if not exists transfer_role text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_transfer_role_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_transfer_role_check
      check (transfer_role is null or transfer_role in ('principal_out', 'principal_in', 'fee'));
  end if;
end $$;

create index if not exists idx_transactions_transfer_group_id
  on public.transactions(transfer_group_id)
  where transfer_group_id is not null;
