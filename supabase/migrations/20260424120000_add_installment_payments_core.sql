-- Installment payments core (Tamara/Tabby compatible)
-- Tables: installment_plans, installments, payment_events, ledger_entries, reconciliation_exceptions
-- Money amounts are stored in MINOR units (integers) to prevent rounding drift.

begin;

-- Enums (idempotent)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'installment_provider') then
    create type public.installment_provider as enum ('TAMARA', 'TABBY', 'OTHER');
  end if;
  if not exists (select 1 from pg_type where typname = 'installment_plan_status') then
    create type public.installment_plan_status as enum (
      'PENDING_ACTIVATION',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'DEFAULTED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'installment_status') then
    create type public.installment_status as enum (
      'SCHEDULED',
      'DUE',
      'PROCESSING',
      'PAID',
      'FAILED',
      'WAIVED',
      'REFUNDED',
      'CANCELLED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_event_processing_status') then
    create type public.payment_event_processing_status as enum (
      'RECEIVED',
      'PROCESSED',
      'IGNORED',
      'FAILED_RETRYABLE',
      'FAILED_FINAL'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'reconciliation_exception_status') then
    create type public.reconciliation_exception_status as enum ('OPEN', 'RESOLVED', 'IGNORED');
  end if;
end $$;

-- Parent plan
create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.installment_provider not null,
  currency text not null check (currency in ('SAR', 'USD')),
  total_amount_minor bigint not null check (total_amount_minor > 0),
  installment_count integer not null check (installment_count >= 1 and installment_count <= 48),
  -- Optional: first installment higher than the rest (down payment / fees timing)
  first_installment_amount_minor bigint null check (first_installment_amount_minor is null or first_installment_amount_minor > 0),
  -- Provider identifiers
  provider_plan_id text null,
  provider_checkout_id text null,
  merchant_order_id text null,
  status public.installment_plan_status not null default 'PENDING_ACTIVATION',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz null,
  closed_at timestamptz null
);

create index if not exists installment_plans_user_id_idx on public.installment_plans(user_id);
create index if not exists installment_plans_provider_plan_idx on public.installment_plans(provider, provider_plan_id);
create index if not exists installment_plans_provider_checkout_idx on public.installment_plans(provider, provider_checkout_id);

-- Installment schedule
create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.installment_plans(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  due_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  status public.installment_status not null default 'SCHEDULED',
  provider_payment_id text null,
  paid_at timestamptz null,
  failure_code text null,
  failure_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, sequence)
);

create index if not exists installments_plan_id_idx on public.installments(plan_id);
create index if not exists installments_due_date_idx on public.installments(due_date);
create unique index if not exists installments_provider_payment_unique
  on public.installments(provider_payment_id)
  where provider_payment_id is not null;

-- Event store (immutable-ish; raw provider payload stored for audit)
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider public.installment_provider not null,
  provider_event_id text null,
  idempotency_key text not null,
  plan_id uuid null references public.installment_plans(id) on delete set null,
  installment_id uuid null references public.installments(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  processing_status public.payment_event_processing_status not null default 'RECEIVED',
  processing_error text null
);

create unique index if not exists payment_events_provider_event_unique
  on public.payment_events(provider, provider_event_id)
  where provider_event_id is not null;
create unique index if not exists payment_events_idempotency_unique
  on public.payment_events(idempotency_key);
create index if not exists payment_events_plan_idx on public.payment_events(plan_id);
create index if not exists payment_events_installment_idx on public.payment_events(installment_id);
create index if not exists payment_events_status_idx on public.payment_events(processing_status, received_at);

-- Ledger (append-only accounting postings)
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid null references public.installment_plans(id) on delete set null,
  installment_id uuid null references public.installments(id) on delete set null,
  event_id uuid null references public.payment_events(id) on delete set null,
  account text not null,
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('SAR', 'USD')),
  provider_reference text null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_plan_idx on public.ledger_entries(plan_id);
create index if not exists ledger_entries_event_idx on public.ledger_entries(event_id);
create index if not exists ledger_entries_installment_idx on public.ledger_entries(installment_id);

-- Reconciliation exceptions: mismatches, missing events, etc.
create table if not exists public.reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.installment_provider not null,
  plan_id uuid null references public.installment_plans(id) on delete set null,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  status public.reconciliation_exception_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id) on delete set null
);

create index if not exists reconciliation_exceptions_user_idx on public.reconciliation_exceptions(user_id);
create index if not exists reconciliation_exceptions_plan_idx on public.reconciliation_exceptions(plan_id);
create index if not exists reconciliation_exceptions_status_idx on public.reconciliation_exceptions(status, created_at);

-- Helper: updated_at trigger (shared pattern)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists set_installment_plans_updated_at on public.installment_plans;
create trigger set_installment_plans_updated_at before update on public.installment_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_installments_updated_at on public.installments;
create trigger set_installments_updated_at before update on public.installments
for each row execute function public.set_updated_at();

-- RLS
alter table public.installment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.payment_events enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.reconciliation_exceptions enable row level security;

-- Plans: user owns
drop policy if exists "Users can manage own installment_plans" on public.installment_plans;
create policy "Users can manage own installment_plans"
  on public.installment_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Installments: via plan ownership
drop policy if exists "Users can manage installments via plan" on public.installments;
create policy "Users can manage installments via plan"
  on public.installments
  for all
  using (exists (select 1 from public.installment_plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.installment_plans p where p.id = plan_id and p.user_id = auth.uid()));

-- Payment events: via plan ownership when plan_id present; otherwise deny to clients (service role bypasses anyway)
drop policy if exists "Users can select payment_events via plan" on public.payment_events;
create policy "Users can select payment_events via plan"
  on public.payment_events
  for select
  using (plan_id is not null and exists (select 1 from public.installment_plans p where p.id = plan_id and p.user_id = auth.uid()));

drop policy if exists "Users can insert payment_events none" on public.payment_events;
create policy "Users can insert payment_events none"
  on public.payment_events
  for insert
  with check (false);

drop policy if exists "Users can update payment_events none" on public.payment_events;
create policy "Users can update payment_events none"
  on public.payment_events
  for update
  using (false)
  with check (false);

drop policy if exists "Users can delete payment_events none" on public.payment_events;
create policy "Users can delete payment_events none"
  on public.payment_events
  for delete
  using (false);

-- Ledger: read-only for users via plan
drop policy if exists "Users can select ledger_entries via plan" on public.ledger_entries;
create policy "Users can select ledger_entries via plan"
  on public.ledger_entries
  for select
  using (plan_id is not null and exists (select 1 from public.installment_plans p where p.id = plan_id and p.user_id = auth.uid()));

drop policy if exists "Users can mutate ledger_entries none" on public.ledger_entries;
create policy "Users can mutate ledger_entries none"
  on public.ledger_entries
  for all
  using (false)
  with check (false);

-- Reconciliation exceptions: user owns
drop policy if exists "Users can manage own reconciliation_exceptions" on public.reconciliation_exceptions;
create policy "Users can manage own reconciliation_exceptions"
  on public.reconciliation_exceptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;

