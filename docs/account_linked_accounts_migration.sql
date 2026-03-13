-- Add linked_account_ids column to accounts table for Investment platform account mapping
-- This allows Investment type accounts to specify which cash accounts (Checking/Savings) can fund them

-- Add linked_account_ids column (JSONB array of account IDs)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS linked_account_ids jsonb DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN public.accounts.linked_account_ids IS 'For Investment type accounts: array of cash account IDs (Checking/Savings) that can fund this platform. Used to restrict deposit/withdrawal source/destination accounts.';

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_accounts_linked_account_ids ON public.accounts USING gin (linked_account_ids) WHERE linked_account_ids IS NOT NULL;
