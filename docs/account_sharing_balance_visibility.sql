-- Add balance visibility option to account sharing

-- Add show_balance column to account_shares table
alter table public.account_shares add column if not exists show_balance boolean default true;

-- Update the get_shared_accounts_for_me function to conditionally return balance
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
  owner_email text,
  show_balance boolean
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
    case when coalesce(s.show_balance, true) then a.balance else null end as balance,
    a.owner,
    s.owner_user_id,
    coalesce(owner_u.email, s.owner_user_id::text) as owner_email,
    coalesce(s.show_balance, true) as show_balance
  from public.account_shares s
  join public.accounts a on a.id = s.account_id
  left join auth.users owner_u on owner_u.id = s.owner_user_id
  where s.shared_with_user_id = auth.uid();
$$;

revoke all on function public.get_shared_accounts_for_me() from public;
grant execute on function public.get_shared_accounts_for_me() to authenticated;
