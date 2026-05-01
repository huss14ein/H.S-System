-- Credit cards: link Liability (Credit Card) to Account (Credit) + optional statement cycles.

alter table public.liabilities
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create index if not exists idx_liabilities_account_id on public.liabilities(account_id) where account_id is not null;

comment on column public.liabilities.account_id is 'When type is Credit Card: links to the Credit account used for card transactions and balance mirror.';

create table if not exists public.credit_card_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_account_id uuid not null references public.accounts(id) on delete cascade,
  statement_start date not null,
  statement_end date not null,
  due_date date,
  statement_balance numeric,
  minimum_due numeric,
  apr numeric,
  status text not null default 'open' check (status in ('open', 'closed', 'paid')),
  created_at timestamptz default now()
);

create index if not exists credit_card_statements_user_idx on public.credit_card_statements(user_id);
create index if not exists credit_card_statements_credit_account_idx on public.credit_card_statements(credit_account_id);
create index if not exists credit_card_statements_period_idx on public.credit_card_statements(credit_account_id, statement_start, statement_end);

alter table public.credit_card_statements enable row level security;

drop policy if exists "Users can manage own credit_card_statements" on public.credit_card_statements;
create policy "Users can manage own credit_card_statements"
  on public.credit_card_statements
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.credit_card_statements to authenticated;
