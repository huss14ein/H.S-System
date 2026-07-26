-- Rewards / points / cashback ledger (KSA resident wealth OS).
-- Additive + RLS. No live loyalty APIs — balances are user-asserted or in-app mapped.
-- Live-data safe: create-if-not-exists tables only.

create table if not exists public.rewards_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_name text not null,
  reward_type text not null check (reward_type in ('points', 'miles', 'cash')),
  unit_label text not null default 'points',
  fiat_currency text not null default 'SAR' check (fiat_currency in ('SAR', 'USD')),
  points_per_fiat_unit numeric not null default 100 check (points_per_fiat_unit > 0),
  current_balance numeric not null default 0,
  linked_account_id text null,
  linked_liability_id text null,
  owner text null,
  expiry_policy_days integer null,
  template_key text null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rewards_accounts_user_idx
  on public.rewards_accounts (user_id, created_at desc);

alter table public.rewards_accounts enable row level security;

drop policy if exists "Users manage own rewards_accounts" on public.rewards_accounts;
create policy "Users manage own rewards_accounts"
  on public.rewards_accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.rewards_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.rewards_accounts(id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'earn', 'redeem', 'expire', 'adjust', 'transfer_in', 'transfer_out'
  )),
  amount numeric not null,
  fiat_equivalent numeric not null default 0,
  rate_snapshot numeric null,
  effective_date date not null default (timezone('utc', now())::date),
  expires_on date null,
  note text null,
  reason text null,
  idempotency_key text not null,
  redemption_group_id text null,
  status text not null default 'posted' check (status in ('posted', 'incomplete', 'reversed')),
  reverses_tx_id uuid null references public.rewards_transactions(id),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists rewards_transactions_user_idx
  on public.rewards_transactions (user_id, created_at desc);
create index if not exists rewards_transactions_account_idx
  on public.rewards_transactions (account_id, effective_date);
create index if not exists rewards_transactions_expires_idx
  on public.rewards_transactions (user_id, expires_on)
  where expires_on is not null and transaction_type = 'earn';

alter table public.rewards_transactions enable row level security;

drop policy if exists "Users manage own rewards_transactions" on public.rewards_transactions;
create policy "Users manage own rewards_transactions"
  on public.rewards_transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.rewards_tx_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_tx_id uuid not null references public.rewards_transactions(id) on delete cascade,
  financial_tx_id text null,
  investment_tx_id text null,
  link_kind text not null check (link_kind in (
    'statement_credit', 'broker_deposit', 'cash_deposit', 'spend_earn', 'other'
  )),
  created_at timestamptz not null default now()
);

create index if not exists rewards_tx_links_user_idx
  on public.rewards_tx_links (user_id, created_at desc);
create index if not exists rewards_tx_links_reward_tx_idx
  on public.rewards_tx_links (reward_tx_id);

alter table public.rewards_tx_links enable row level security;

drop policy if exists "Users manage own rewards_tx_links" on public.rewards_tx_links;
create policy "Users manage own rewards_tx_links"
  on public.rewards_tx_links for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.rewards_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.rewards_accounts(id) on delete cascade,
  earn_tx_id uuid not null references public.rewards_transactions(id) on delete cascade,
  quantity_remaining numeric not null default 0,
  expires_on date null,
  created_at timestamptz not null default now()
);

create index if not exists rewards_lots_user_expires_idx
  on public.rewards_lots (user_id, expires_on)
  where quantity_remaining > 0;

alter table public.rewards_lots enable row level security;

drop policy if exists "Users manage own rewards_lots" on public.rewards_lots;
create policy "Users manage own rewards_lots"
  on public.rewards_lots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.rewards_accounts is
  'Loyalty/cashback accounts (manual balances). No live bank/airline API sync.';
comment on table public.rewards_transactions is
  'Append-oriented rewards lifecycle ledger with idempotency keys.';
comment on table public.rewards_tx_links is
  'Maps reward redemptions/earns to cash or investment ledger rows.';
