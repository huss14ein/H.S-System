-- Dedupe holdings ghosts then enforce one row per (user, portfolio, symbol).
-- Prevents auto-heal / trade side-effects from summing historical qty (e.g. LCID 500→1890).
-- Prefer EXACT ledger-net match; otherwise newest id. Never "nearest" drift (that kept ghosts).
--
-- LIVE-DATA SAFE: no table is dropped, recreated, or truncated, and no column is removed.
-- The only rows removed are duplicate holdings for the same (user, portfolio, symbol) — and every
-- removed row is archived first in public.holdings_dedupe_backup, so the delete is reversible.
-- Re-running this file is harmless: after the unique index exists there is nothing left to remove.

begin;

create table if not exists public.holdings_dedupe_backup (
  backup_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  removed_at timestamptz not null default now(),
  migration text not null,
  row_data jsonb not null
);

alter table public.holdings_dedupe_backup enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'holdings_dedupe_backup'
      and policyname = 'Users read own holdings_dedupe_backup'
  ) then
    create policy "Users read own holdings_dedupe_backup"
      on public.holdings_dedupe_backup for select
      using (auth.uid() = user_id);
  end if;
end
$$;

WITH ledger_net AS (
  SELECT
    t.user_id,
    t.portfolio_id,
    upper(trim(t.symbol)) AS sym,
    greatest(
      0,
      coalesce(
        sum(
          CASE
            WHEN t.type = 'buy' THEN coalesce(t.quantity, 0)
            WHEN t.type = 'sell' THEN -coalesce(t.quantity, 0)
            ELSE 0
          END
        ),
        0
      )
    ) AS net_qty
  FROM public.investment_transactions t
  WHERE t.portfolio_id IS NOT NULL
    AND nullif(trim(t.symbol), '') IS NOT NULL
  GROUP BY t.user_id, t.portfolio_id, upper(trim(t.symbol))
),
ranked AS (
  SELECT
    h.id,
    h.user_id,
    h.portfolio_id,
    upper(trim(h.symbol)) AS sym,
    row_number() OVER (
      PARTITION BY h.user_id, h.portfolio_id, upper(trim(h.symbol))
      ORDER BY
        CASE
          WHEN ln.net_qty IS NOT NULL
            AND abs(coalesce(h.quantity, 0) - ln.net_qty) < 0.000001 THEN 0
          ELSE 1
        END ASC,
        h.id DESC
    ) AS rn
  FROM public.holdings h
  LEFT JOIN ledger_net ln
    ON ln.user_id = h.user_id
   AND ln.portfolio_id = h.portfolio_id
   AND ln.sym = upper(trim(h.symbol))
),
removed AS (
  DELETE FROM public.holdings h
  USING ranked r
  WHERE h.id = r.id
    AND r.rn > 1
  RETURNING h.*
)
INSERT INTO public.holdings_dedupe_backup (user_id, migration, row_data)
SELECT removed.user_id,
       '20260722120000_holdings_unique_per_portfolio_symbol',
       to_jsonb(removed)
FROM removed;

CREATE UNIQUE INDEX IF NOT EXISTS holdings_user_portfolio_symbol_uidx
  ON public.holdings (user_id, portfolio_id, (upper(trim(symbol))));

commit;
