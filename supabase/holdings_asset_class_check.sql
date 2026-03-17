-- Fix holdings.asset_class check constraint so it accepts app values.
-- Error: new row for relation "holdings" violates check constraint "holdings_asset_class_check"
-- Run this in Supabase SQL editor.

-- Add column if it was added by a different migration with a different check
alter table if exists public.holdings
  add column if not exists asset_class text;

-- Drop existing check so we can replace it with the full allowed list
alter table if exists public.holdings
  drop constraint if exists holdings_asset_class_check;

-- Allow exactly the values the app sends (HoldingAssetClass)
alter table public.holdings
  add constraint holdings_asset_class_check check (
    asset_class is null
    or asset_class in (
      'Stock', 'Sukuk', 'Mutual Fund', 'ETF', 'REIT', 'Cryptocurrency', 'Commodity',
      'CD', 'Private Equity', 'Venture Capital', 'Savings Bond', 'NFT', 'Other'
    )
  );
