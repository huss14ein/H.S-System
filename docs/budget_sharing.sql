-- Budget sharing (share only budgets with specific users)
-- Run in Supabase SQL editor.

create table if not exists public.budget_shares (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  shared_with_user_id uuid not null references public.users(id) on delete cascade,
  owner_email text,
  category text null,
  created_at timestamptz not null default now(),
  unique(owner_user_id, shared_with_user_id, category)
);

alter table public.budget_shares enable row level security;

-- Owner can create/update/delete shares they own.
create policy if not exists budget_shares_owner_write
on public.budget_shares
for all
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

-- Recipient can read only rows shared with them.
create policy if not exists budget_shares_recipient_read
on public.budget_shares
for select
using (auth.uid() = shared_with_user_id or auth.uid() = owner_user_id);

-- Optional hardening: ensure budgets remain owner-private at DB level.
alter table public.budgets enable row level security;
create policy if not exists budgets_owner_only
on public.budgets
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
