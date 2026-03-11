begin;

create table if not exists public.users (
  id uuid primary key,
  name text,
  role text not null default 'Restricted' check (role in ('Admin','Restricted')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  monthly_limit numeric not null default 0,
  total_spent numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  user_id uuid not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

create table if not exists public.budget_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_type text not null check (request_type in ('NewCategory','IncreaseLimit')),
  category_id uuid null references public.categories(id) on delete set null,
  category_name text,
  amount numeric not null,
  status text not null default 'Pending' check (status in ('Pending','Finalized','Rejected')),
  created_at timestamptz not null default now()
);

alter table if exists public.transactions
  add column if not exists status text not null default 'Approved' check (status in ('Pending','Approved','Rejected')),
  add column if not exists category_id uuid null references public.categories(id) on delete set null,
  add column if not exists note text,
  add column if not exists rejection_reason text;

create index if not exists idx_permissions_user on public.permissions(user_id);
create index if not exists idx_budget_requests_status on public.budget_requests(status, created_at desc);
create unique index if not exists idx_budget_requests_pending_newcategory_unique
  on public.budget_requests(user_id, lower(trim(category_name)), request_type)
  where status = 'Pending' and request_type = 'NewCategory' and category_name is not null;
create unique index if not exists idx_budget_requests_pending_increaselimit_unique
  on public.budget_requests(user_id, category_id, request_type)
  where status = 'Pending' and request_type = 'IncreaseLimit' and category_id is not null;
create index if not exists idx_transactions_status on public.transactions(status, date desc);
create index if not exists idx_transactions_category_id on public.transactions(category_id);

create or replace function public.apply_approved_transaction_to_category(p_category_name text, p_amount numeric)
returns void
language plpgsql
as $$
begin
  update public.categories
  set total_spent = coalesce(total_spent, 0) + coalesce(p_amount, 0)
  where name = p_category_name;
end;
$$;


create or replace function public.approve_pending_transaction(p_transaction_id uuid)
returns void
language plpgsql
as $$
declare
  tx record;
  tx_json jsonb;
  tx_status text;
  tx_amount numeric;
  budget_category_name text;
begin
  select *
  into tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction % not found', p_transaction_id;
  end if;

  tx_json := to_jsonb(tx);
  tx_status := coalesce(tx_json->>'status', 'Approved');
  tx_amount := nullif(tx_json->>'amount', '')::numeric;
  budget_category_name := coalesce(tx_json->>'budgetCategory', tx_json->>'budget_category');

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Approved'
  where id = p_transaction_id;

  if budget_category_name is not null and tx_amount is not null then
    update public.categories
    set total_spent = coalesce(total_spent, 0) + abs(tx_amount)
    where name = budget_category_name;
  end if;
end;
$$;


create or replace function public.reject_pending_transaction(p_transaction_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  tx_status text;
begin
  select coalesce(to_jsonb(t)->>'status', 'Approved')
  into tx_status
  from public.transactions t
  where t.id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction % not found', p_transaction_id;
  end if;

  if tx_status <> 'Pending' then
    raise exception 'Transaction % is not pending', p_transaction_id;
  end if;

  update public.transactions
  set status = 'Rejected',
      rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_transaction_id;
end;
$$;

commit;
