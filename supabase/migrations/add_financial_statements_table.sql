-- Migration: Add financial_statements table for Statement Upload feature
-- This table stores uploaded statements and their extracted transactions for audit and reconciliation

-- Create financial_statements table
CREATE TABLE IF NOT EXISTS public.financial_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'csv', 'xlsx', 'xls', 'ofx', 'qfx')),
  file_size BIGINT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_type TEXT CHECK (account_type IN ('checking', 'savings', 'credit', 'investment')),
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  statement_period_start DATE,
  statement_period_end DATE,
  opening_balance NUMERIC DEFAULT 0,
  closing_balance NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'completed', 'failed', 'reviewing')),
  confidence NUMERIC DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  summary JSONB DEFAULT '{}',
  errors JSONB DEFAULT '[]',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create extracted_transactions table (normalized from statements)
CREATE TABLE IF NOT EXISTS public.extracted_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.financial_statements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debit', 'credit')),
  balance NUMERIC,
  category TEXT,
  subcategory TEXT,
  tags JSONB DEFAULT '[]',
  confidence NUMERIC DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  raw_text TEXT,
  matched_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  reconciliation_status TEXT DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched', 'matched', 'duplicate', 'discrepancy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_financial_statements_user_id ON public.financial_statements(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_statements_account_id ON public.financial_statements(account_id);
CREATE INDEX IF NOT EXISTS idx_financial_statements_status ON public.financial_statements(status);
CREATE INDEX IF NOT EXISTS idx_financial_statements_uploaded_at ON public.financial_statements(uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_extracted_transactions_statement_id ON public.extracted_transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_extracted_transactions_user_id ON public.extracted_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_extracted_transactions_date ON public.extracted_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_extracted_transactions_reconciliation_status ON public.extracted_transactions(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_extracted_transactions_matched_transaction_id ON public.extracted_transactions(matched_transaction_id);

-- Enable RLS (Row Level Security)
ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own statements
CREATE POLICY "Users can view their own financial statements"
  ON public.financial_statements
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own financial statements"
  ON public.financial_statements
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own financial statements"
  ON public.financial_statements
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own financial statements"
  ON public.financial_statements
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own extracted transactions"
  ON public.extracted_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own extracted transactions"
  ON public.extracted_transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own extracted transactions"
  ON public.extracted_transactions
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own extracted transactions"
  ON public.extracted_transactions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE public.financial_statements IS 'Stores uploaded bank/trading statements and their metadata';
COMMENT ON TABLE public.extracted_transactions IS 'Stores transactions extracted from uploaded statements for review and reconciliation';
COMMENT ON COLUMN public.financial_statements.summary IS 'JSON object with totalCredits, totalDebits, netChange, transactionCount, categories, etc.';
COMMENT ON COLUMN public.financial_statements.errors IS 'JSON array of error messages if processing failed';
COMMENT ON COLUMN public.extracted_transactions.tags IS 'JSON array of tags for categorization';
COMMENT ON COLUMN public.extracted_transactions.matched_transaction_id IS 'Links to the actual transaction if reconciliation matched this extracted transaction';
