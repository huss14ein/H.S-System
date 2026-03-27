-- Rejection used the same flag as "pending" (approved = false), so rejected users
-- stayed in the admin pending list after refresh. Distinct state: signup_rejected.

begin;

alter table public.users add column if not exists signup_rejected boolean not null default false;

comment on column public.users.signup_rejected is
  'When true, an admin rejected this signup; user stays unapproved and is hidden from the pending queue.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  set local row_security = off;
  insert into public.users (id, name, email, role, approved, signup_rejected)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'Restricted',
    false,
    false
  )
  on conflict (id) do update set
    name = coalesce(excluded.name, public.users.name),
    email = coalesce(excluded.email, public.users.email);
  return new;
end;
$$;

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
  update public.users
  set approved = true, signup_rejected = false
  where id = p_user_id;
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
  update public.users
  set approved = false, signup_rejected = true
  where id = p_user_id;
  return found;
end;
$$;

commit;
