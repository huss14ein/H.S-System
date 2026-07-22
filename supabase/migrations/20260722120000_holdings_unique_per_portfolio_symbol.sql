-- Dedupe holdings ghosts then enforce one row per (user, portfolio, symbol).
-- Prevents auto-heal / trade side-effects from summing historical qty (e.g. LCID 500→1890).
-- Prefer EXACT ledger-net match; otherwise newest id. Never "nearest" drift (that kept ghosts).

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
)
DELETE FROM public.holdings h
USING ranked r
WHERE h.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS holdings_user_portfolio_symbol_uidx
  ON public.holdings (user_id, portfolio_id, (upper(trim(symbol))));
