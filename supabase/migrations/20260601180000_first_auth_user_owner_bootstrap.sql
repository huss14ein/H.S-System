-- End-to-end fix: project owner (first auth signup) must never stay on pending approval.
-- Also ignores ghost admin rows that no longer exist in auth.users.

begin;

-- One-shot heal: earliest auth signup is the project owner.
update public.users u
set approved = true, role = 'Admin', signup_rejected = false
from (
  select id from auth.users order by created_at asc nulls last limit 1
) owner
where u.id = owner.id
  and coalesce(u.signup_rejected, false) = false;

-- Verified email users still stuck on approved=false.
update public.users u
set approved = true
from auth.users au
where u.id = au.id
  and au.email_confirmed_at is not null
  and coalesce(u.signup_rejected, false) = false
  and coalesce(u.approved, false) = false;

-- First signup should never start as Restricted/pending.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_count integer;
  has_live_admin boolean;
begin
  set local row_security = off;

  select count(*)::integer into auth_count from auth.users;

  select exists (
    select 1
    from public.users pu
    inner join auth.users au on au.id = pu.id
    where lower(trim(pu.role)) = 'admin'
      and coalesce(pu.approved, false) = true
  ) into has_live_admin;

  insert into public.users (id, name, email, role, approved, signup_rejected)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    case when auth_count = 1 or not has_live_admin then 'Admin' else 'Restricted' end,
    auth_count = 1 or not has_live_admin or new.email_confirmed_at is not null,
    false
  )
  on conflict (id) do update set
    name = coalesce(excluded.name, public.users.name),
    email = coalesce(excluded.email, public.users.email);
  return new;
end;
$$;

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
  owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::integer into auth_count from auth.users;
  select id into owner_id from auth.users order by created_at asc nulls last limit 1;
  select email_confirmed_at into email_confirmed from auth.users where id = auth.uid();

  select exists (
    select 1
    from public.users pu
    inner join auth.users au on au.id = pu.id
    where lower(trim(pu.role)) = 'admin'
      and coalesce(pu.approved, false) = true
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
      case when auth.uid() = owner_id or not has_admin or auth_count = 1 then 'Admin' else 'Restricted' end,
      auth.uid() = owner_id or not has_admin or auth_count = 1 or email_confirmed is not null,
      false
    )
    on conflict (id) do update set
      name = coalesce(excluded.name, public.users.name),
      email = coalesce(excluded.email, public.users.email)
    returning * into r;
  end if;

  if auth.uid() = owner_id and coalesce(r.signup_rejected, false) = false then
    update public.users
    set approved = true, role = 'Admin', signup_rejected = false
    where id = auth.uid()
    returning * into r;
  elsif lower(trim(coalesce(r.role, ''))) = 'admin' and coalesce(r.approved, false) = false then
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

comment on function public.ensure_own_user_profile() is
  'Ensures public.users for auth.uid(); auto-approves project owner (first auth signup), Admin, single-tenant, or verified email.';

grant execute on function public.ensure_own_user_profile() to authenticated;

commit;
