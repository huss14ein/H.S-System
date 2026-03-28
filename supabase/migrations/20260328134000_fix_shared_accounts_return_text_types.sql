-- Fix shared accounts RPC return type strictness (varchar -> text) for Postgres function result typing.

begin;

create or replace function public.get_shared_accounts_for_me()
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
language plpgsql
security definer
set search_path = public
as $$
begin
  set local row_security = off;
  return query
  select
    a.id,
    a.id as account_id,
    a.user_id,
    a.name::text as name,
    a.type::text as type,
    case when coalesce(s.show_balance, true) then a.balance else null end as balance,
    a.owner::text as owner,
    s.owner_user_id,
    coalesce(owner_u.email::text, s.owner_user_id::text) as owner_email,
    coalesce(s.show_balance, true) as show_balance
  from public.account_shares s
  join public.accounts a on a.id = s.account_id
  left join auth.users owner_u on owner_u.id = s.owner_user_id
  where s.shared_with_user_id = auth.uid();
end;
$$;

revoke all on function public.get_shared_accounts_for_me() from public;
grant execute on function public.get_shared_accounts_for_me() to authenticated;

commit;
