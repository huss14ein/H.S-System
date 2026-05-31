-- Auto-approve verified auth users stuck on approved=false (mobile/web mismatch).
-- Safe: skips signup_rejected; pairs with app resolveEffectiveAppAccess for confirmed email.

begin;

update public.users u
set approved = true
from auth.users au
where u.id = au.id
  and au.email_confirmed_at is not null
  and coalesce(u.signup_rejected, false) = false
  and coalesce(u.approved, false) = false;

create or replace function public.ensure_own_user_profile()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.users;
  has_admin boolean;
  auth_email text;
  auth_name text;
  auth_count integer;
  email_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::integer into auth_count from auth.users;

  select email_confirmed_at into email_confirmed from auth.users where id = auth.uid();

  select exists (
    select 1 from public.users
    where lower(trim(role)) = 'admin' and coalesce(approved, false) = true
  ) into has_admin;

  select * into r from public.users where id = auth.uid();

  if not found then
    select email, coalesce(raw_user_meta_data->>'full_name', '')
    into auth_email, auth_name
    from auth.users
    where id = auth.uid();

    insert into public.users (id, name, email, role, approved, signup_rejected)
    values (
      auth.uid(),
      auth_name,
      coalesce(auth_email, ''),
      case when not has_admin or auth_count = 1 then 'Admin' else 'Restricted' end,
      not has_admin or auth_count = 1 or email_confirmed is not null,
      false
    )
    on conflict (id) do update set
      name = coalesce(excluded.name, public.users.name),
      email = coalesce(excluded.email, public.users.email)
    returning * into r;
  end if;

  if lower(trim(coalesce(r.role, ''))) = 'admin' and coalesce(r.approved, false) = false then
    update public.users
    set approved = true, signup_rejected = false
    where id = auth.uid()
    returning * into r;
  elsif auth_count = 1 and coalesce(r.approved, false) = false and coalesce(r.signup_rejected, false) = false then
    update public.users
    set approved = true, role = 'Admin', signup_rejected = false
    where id = auth.uid()
    returning * into r;
  elsif not has_admin
    and coalesce(r.approved, false) = false
    and coalesce(r.signup_rejected, false) = false
  then
    update public.users
    set approved = true, role = 'Admin', signup_rejected = false
    where id = auth.uid()
    returning * into r;
  elsif email_confirmed is not null
    and coalesce(r.approved, false) = false
    and coalesce(r.signup_rejected, false) = false
  then
    update public.users set approved = true where id = auth.uid() returning * into r;
  elsif r.approved is null then
    update public.users set approved = true where id = auth.uid() returning * into r;
  end if;

  return r;
end;
$$;

grant execute on function public.ensure_own_user_profile() to authenticated;

commit;
