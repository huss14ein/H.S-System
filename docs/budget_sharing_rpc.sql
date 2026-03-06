-- Budget sharing recipient lookup helper (safe to run multiple times)
-- NOTE: Paste only SQL statements into Supabase SQL Editor.
-- Do NOT paste git diff headers such as: diff --git a/... b/...

create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, au.email
  from public.users u
  join auth.users au on au.id = u.id
  where lower(au.email) = lower(target_email)
  limit 1
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;
