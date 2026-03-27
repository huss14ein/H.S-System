-- User approval flow: new signups require admin approval before accessing the app.
-- Run after multi_user_governance.sql (or all_db_changes_and_enhancements.sql) so public.users exists.
--
-- Bootstrap first admin: after first user signs up, run in SQL editor:
--   UPDATE public.users SET role = 'Admin', approved = true WHERE email = 'your-admin@example.com';

begin;

-- 1. Ensure public.users exists (idempotent; matches multi_user_governance schema)
create table if not exists public.users (
  id uuid primary key,
  name text,
  role text not null default 'Restricted' check (role in ('Admin','Restricted')),
  created_at timestamptz not null default now()
);

-- 2. Add approval and email columns (existing rows get approved=true for backward compat)
alter table public.users add column if not exists email text;
alter table public.users add column if not exists approved boolean default true;

-- 3. Backfill email from auth.users for existing rows (optional; runs only if auth.users exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    update public.users u
    set email = coalesce(au.email, u.email)
    from auth.users au
    where u.id = au.id and (u.email is null or u.email = '');
  end if;
end $$;

-- 4. Trigger: on new auth signup, create public.users row with approved=false
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- RLS on public.users otherwise blocks this INSERT (Supabase shows "Database error saving new user").
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. RLS for public.users: users read own row; admins read all and can update approved
alter table public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users for select using (auth.uid() = id);

-- Admin can select all users (for approval list) and update approved/role
create or replace function public.is_admin_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and lower(trim(role)) = 'admin'
  );
$$;

drop policy if exists "users_admin_select_all" on public.users;
create policy "users_admin_select_all" on public.users for select
  using (public.is_admin_user());

drop policy if exists "users_admin_update_approved" on public.users;
create policy "users_admin_update_approved" on public.users for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

-- 6. RPC for admins to approve or reject users
create or replace function public.approve_signup_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Only admins can approve users';
  end if;
  update public.users set approved = true where id = p_user_id;
  return found;
end;
$$;

create or replace function public.reject_signup_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Only admins can reject users';
  end if;
  -- Optionally delete the user row (blocks future login) or leave as approved=false
  update public.users set approved = false where id = p_user_id;
  return found;
end;
$$;

grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.approve_signup_user(uuid) to authenticated;
grant execute on function public.reject_signup_user(uuid) to authenticated;

commit;
