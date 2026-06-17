-- Security hardening: RLS for wealth_ultra_config, signup approval gate, share lookup limits.

begin;

-- -----------------------------------------------------------------------------
-- wealth_ultra_config — per-user rows + read-only global defaults
-- -----------------------------------------------------------------------------
alter table if exists public.wealth_ultra_config enable row level security;

drop policy if exists "wealth_ultra_config_select_own_or_global" on public.wealth_ultra_config;
create policy "wealth_ultra_config_select_own_or_global"
  on public.wealth_ultra_config for select
  using (user_id is null or auth.uid() = user_id);

drop policy if exists "wealth_ultra_config_manage_own" on public.wealth_ultra_config;
create policy "wealth_ultra_config_manage_own"
  on public.wealth_ultra_config for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Signup approval — verified email alone must NOT bypass admin approval
-- -----------------------------------------------------------------------------
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
    auth_count = 1 or not has_live_admin,
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
  owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::integer into auth_count from auth.users;
  select id into owner_id from auth.users order by created_at asc nulls last limit 1;

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
      auth.uid() = owner_id or not has_admin or auth_count = 1,
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
  end if;

  return r;
end;
$$;

comment on function public.ensure_own_user_profile() is
  'Ensures public.users for auth.uid(); auto-approves project owner, first signup, or single-tenant only — not email verification alone.';

-- -----------------------------------------------------------------------------
-- Share recipient lookup — approved users only; do not leak stored email variants
-- -----------------------------------------------------------------------------
create or replace function public.find_user_by_email(target_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select usr.id, lower(trim(target_email))::text as email
  from public.users as usr
  join auth.users as au on au.id = usr.id
  where lower(au.email) = lower(trim(target_email))
    and length(trim(coalesce(target_email, ''))) >= 5
    and position('@' in trim(target_email)) > 1
    and coalesce(usr.approved, false) = true
    and coalesce(usr.signup_rejected, false) = false
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

commit;
