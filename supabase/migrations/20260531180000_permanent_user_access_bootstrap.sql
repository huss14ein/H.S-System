-- Permanent fix: admins and single-tenant owners must never stay blocked on approved=false.
-- Also hardens ensure_own_user_profile so mobile login always self-heals access flags.

begin;

alter table public.users add column if not exists email text;
alter table public.users add column if not exists approved boolean default true;
alter table public.users add column if not exists signup_rejected boolean not null default false;

-- Admins are always approved (app invariant; fixes laptop/mobile mismatch when approved column is stale).
update public.users
set approved = true, signup_rejected = false
where lower(trim(coalesce(role, ''))) = 'admin'
  and coalesce(signup_rejected, false) = false;

-- Single-tenant install: the only auth user is the owner — auto-approve as Admin.
do $$
declare
  auth_count integer;
  only_id uuid;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    return;
  end if;

  select count(*)::integer into auth_count from auth.users;
  if auth_count = 1 then
    select id into only_id from auth.users limit 1;
    update public.users
    set approved = true, role = 'Admin', signup_rejected = false
    where id = only_id;
  end if;
end $$;

-- Legacy NULL approved must never block.
update public.users set approved = true where approved is null;

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
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::integer into auth_count from auth.users;

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
      not has_admin or auth_count = 1,
      false
    )
    on conflict (id) do update set
      name = coalesce(excluded.name, public.users.name),
      email = coalesce(excluded.email, public.users.email)
    returning * into r;
  end if;

  -- Self-heal: Admin role, single-tenant owner, or no approved admin yet.
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
  elsif r.approved is null then
    update public.users set approved = true where id = auth.uid() returning * into r;
  end if;

  return r;
end;
$$;

comment on function public.ensure_own_user_profile() is
  'Ensures public.users for auth.uid(); auto-approves Admin, single-tenant owner, or first user when no approved Admin exists.';

grant execute on function public.ensure_own_user_profile() to authenticated;

commit;
