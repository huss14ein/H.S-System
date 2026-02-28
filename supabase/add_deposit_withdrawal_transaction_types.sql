-- Add 'deposit' and 'withdrawal' to investment_transactions for cash flow tracking.
-- Per-platform available cash = Sum(deposits) - Sum(withdrawals) - Sum(buys) + Sum(sells) + Sum(dividends).

-- Drop existing check and add new one
ALTER TABLE public.investment_transactions
  DROP CONSTRAINT IF EXISTS investment_transactions_type_check;

ALTER TABLE public.investment_transactions
  ADD CONSTRAINT investment_transactions_type_check
  CHECK (type IN ('buy', 'sell', 'dividend', 'deposit', 'withdrawal'));

-- Optional: allow symbol to be empty for deposit/withdrawal (if your app sends '')
-- Standard is to keep symbol NOT NULL and use a placeholder e.g. 'CASH' for deposit/withdrawal.
-- No column change needed if app uses symbol = 'CASH' for these types.
