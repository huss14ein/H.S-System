-- Ensure share-user discovery RPCs exist and return stable text types.

begin;

create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select usr.id, au.email::text as email
  from public.users as usr
  join auth.users as au on au.id = usr.id
  where lower(au.email) = lower(target_email)
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create or replace function public.list_shareable_users()
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select usr.id, au.email::text as email
  from public.users as usr
  join auth.users as au on au.id = usr.id
  where usr.id <> auth.uid()
    and exists (
      select 1
      from public.users as me
      where me.id = auth.uid()
        and lower(coalesce(me.role, '')) = 'admin'
    )
  order by lower(au.email);
$$;

revoke all on function public.list_shareable_users() from public;
grant execute on function public.list_shareable_users() to authenticated;

commit;
