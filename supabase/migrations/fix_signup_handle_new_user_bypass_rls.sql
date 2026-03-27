-- Signup fails with "Database error saving new user" when RLS on public.users
-- blocks the INSERT from handle_new_user() (AFTER INSERT on auth.users).
-- SECURITY DEFINER alone does not bypass RLS unless the role is superuser/table owner
-- in all setups; SET LOCAL row_security = off applies for this function's INSERT.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Required so INSERT into public.users succeeds when RLS is enabled on that table.
  set local row_security = off;
  insert into public.users (id, name, email, role, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'Restricted',
    false
  )
  on conflict (id) do update set
    name = coalesce(excluded.name, public.users.name),
    email = coalesce(excluded.email, public.users.email);
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates public.users row on auth signup. Uses row_security=off for the insert so RLS on public.users cannot block new signups.';
