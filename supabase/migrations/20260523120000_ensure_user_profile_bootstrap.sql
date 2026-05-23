-- Fix "Account Pending Approval" for legacy auth users missing public.users rows,
-- NULL approved, or single-tenant installs with no approved Admin yet.
-- Safe on minimal public.users (id, name, role only): adds email / approved / signup_rejected first.

begin;

-- Minimal table if governance migration never ran (idempotent).
create table if not exists public.users (
  id uuid primary key,
  name text,
  role text not null default 'Restricted' check (role in ('Admin', 'Restricted')),
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists email text;
alter table public.users add column if not exists approved boolean default true;
alter table public.users add column if not exists signup_rejected boolean not null default false;

-- Backfill email from auth for rows that predate the email column.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    update public.users u
    set email = coalesce(au.email, u.email)
    from auth.users au
    where u.id = au.id and (u.email is null or u.email = '');
  end if;
end $$;

-- Backfill profiles for auth users that predate handle_new_user or lost a row.
insert into public.users (id, name, email, role, approved, signup_rejected)
select
  au.id,
  coalesce(au.raw_user_meta_data->>'full_name', ''),
  coalesce(au.email, ''),
  'Restricted',
  true,
  false
from auth.users au
left join public.users u on u.id = au.id
where u.id is null
on conflict (id) do nothing;

-- Legacy rows: NULL approved should not block access.
update public.users
set approved = true
where approved is null;

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
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

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
      case when not has_admin then 'Admin' else 'Restricted' end,
      not has_admin,
      false
    )
    on conflict (id) do update set
      name = coalesce(excluded.name, public.users.name),
      email = coalesce(excluded.email, public.users.email)
    returning * into r;
  elsif not has_admin
    and coalesce(r.approved, false) = false
    and coalesce(r.signup_rejected, false) = false
  then
    update public.users
    set approved = true, role = 'Admin', signup_rejected = false
    where id = auth.uid()
    returning * into r;
  elsif r.approved is null then
    update public.users set approved = true where id = auth.uid() returning * into r;
  elsif lower(trim(coalesce(r.role, ''))) = 'admin' and coalesce(r.approved, false) = false then
    update public.users
    set approved = true, signup_rejected = false
    where id = auth.uid()
    returning * into r;
  end if;

  return r;
end;
$$;

comment on function public.ensure_own_user_profile() is
  'Ensures public.users row for auth.uid(). Backfills missing rows; auto-approves as Admin when no approved Admin exists (single-tenant bootstrap).';

grant execute on function public.ensure_own_user_profile() to authenticated;

commit;
