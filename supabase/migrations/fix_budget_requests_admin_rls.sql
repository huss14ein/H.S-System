-- Ensure admin can review and action budget requests even when
-- rls_all_user_tables.sql sets "own rows only" on budget_requests.

begin;

-- Recreate helper in case add_user_approval.sql was not applied yet.
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

alter table if exists public.budget_requests enable row level security;

-- Keep regular users restricted to their own requests.
drop policy if exists "budget_requests_select_own" on public.budget_requests;
create policy "budget_requests_select_own"
  on public.budget_requests
  for select
  using (auth.uid() = user_id);

drop policy if exists "budget_requests_insert_own" on public.budget_requests;
create policy "budget_requests_insert_own"
  on public.budget_requests
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "budget_requests_update_own" on public.budget_requests;
create policy "budget_requests_update_own"
  on public.budget_requests
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin can review all requests and finalize/reject any request.
drop policy if exists "budget_requests_admin_select_all" on public.budget_requests;
create policy "budget_requests_admin_select_all"
  on public.budget_requests
  for select
  using (public.is_admin_user());

drop policy if exists "budget_requests_admin_update_all" on public.budget_requests;
create policy "budget_requests_admin_update_all"
  on public.budget_requests
  for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

grant execute on function public.is_admin_user() to authenticated;

commit;
