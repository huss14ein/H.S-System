-- Fix: Add recurring_id column to transactions table
-- This column links transactions to the recurring rule that created them

-- Add the column if it doesn't exist
alter table if exists public.transactions
  add column if not exists recurring_id uuid;

-- Create index for performance
create index if not exists idx_transactions_recurring_id 
  on public.transactions(recurring_id) 
  where recurring_id is not null;

-- Verify the column was added
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'transactions' 
  and column_name = 'recurring_id';
