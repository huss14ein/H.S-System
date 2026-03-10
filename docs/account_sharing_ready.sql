-- Account sharing (owner -> specific recipient) with RLS and recipient read RPC

create table if not exists public.account_shares (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(owner_user_id, shared_with_user_id, account_id)
);

alter table public.account_shares enable row level security;

drop policy if exists account_shares_owner_write on public.account_shares;
create policy account_shares_owner_write
  on public.account_shares
  for all
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists account_shares_recipient_read on public.account_shares;
create policy account_shares_recipient_read
  on public.account_shares
  for select
  using (auth.uid() = shared_with_user_id);

drop function if exists public.get_shared_accounts_for_me();
create function public.get_shared_accounts_for_me()
returns table (
  id uuid,
  account_id uuid,
  user_id uuid,
  name text,
  type text,
  balance numeric,
  owner text,
  owner_user_id uuid,
  owner_email text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.id as account_id,
    a.user_id,
    a.name,
    a.type,
    a.balance,
    a.owner,
    s.owner_user_id,
    coalesce(owner_u.email, s.owner_user_id::text) as owner_email
  from public.account_shares s
  join public.accounts a on a.id = s.account_id
  left join auth.users owner_u on owner_u.id = s.owner_user_id
  where s.shared_with_user_id = auth.uid();
$$;

revoke all on function public.get_shared_accounts_for_me() from public;
grant execute on function public.get_shared_accounts_for_me() to authenticated;
