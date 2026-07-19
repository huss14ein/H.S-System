-- Allow fee / vat investment ledger rows (statement import + broker fee lines).
-- Safe to re-run: drops and recreates the type check constraint.

alter table if exists public.investment_transactions
  drop constraint if exists investment_transactions_type_check;

alter table if exists public.investment_transactions
  add constraint investment_transactions_type_check
  check (type in ('buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee', 'vat'));
