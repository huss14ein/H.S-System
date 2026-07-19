/**
 * Insert payload variants for investment_transactions — prefer full schema, fall back when columns missing.
 */

export type InvestmentTradeInsertInput = {
  accountId?: string | null;
  portfolioId?: string | null;
  portfolio_id?: string | null;
  date?: string;
  type?: string;
  symbol?: string;
  quantity?: number;
  price?: number;
  total?: number;
  currency?: string | null;
  idempotencyKey?: string | null;
  idempotency_key?: string | null;
  linkedCashAccountId?: string | null;
  linked_cash_account_id?: string | null;
};

function dedupePayloadRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Ordered variants for Supabase insert. Missing-column errors (PGRST204) should try the next row.
 * Always includes a core row without optional columns so legacy DBs accept the insert.
 * Callers must stamp portfolioId/currency onto the in-memory row when optional columns were dropped.
 */
export function buildInvestmentTradeInsertVariants(trade: InvestmentTradeInsertInput): Record<string, unknown>[] {
  const core: Record<string, unknown> = {
    account_id: trade.accountId,
    date: trade.date,
    type: trade.type,
    symbol: trade.symbol,
    quantity: trade.quantity,
    price: trade.price,
    total: trade.total,
  };
  const portfolioId = trade.portfolioId ?? trade.portfolio_id;
  const idem = trade.idempotencyKey ?? trade.idempotency_key;
  const currency = trade.currency === 'SAR' || trade.currency === 'USD' ? trade.currency : null;
  const linkedCash = trade.linkedCashAccountId ?? trade.linked_cash_account_id;

  const withOptional = (row: Record<string, unknown>, opts: { portfolio?: boolean; currency?: boolean; linked?: boolean; idem?: boolean }) => {
    const next = { ...row };
    if (opts.portfolio && portfolioId) next.portfolio_id = portfolioId;
    if (opts.currency && currency) next.currency = currency;
    if (opts.linked && linkedCash) next.linked_cash_account_id = linkedCash;
    if (opts.idem && idem) next.idempotency_key = idem;
    return next;
  };

  const variants: Record<string, unknown>[] = [
    withOptional(core, { portfolio: true, currency: true, linked: true, idem: true }),
    withOptional(core, { portfolio: true, currency: true, linked: false, idem: true }),
    withOptional(core, { portfolio: false, currency: true, linked: true, idem: true }),
    withOptional(core, { portfolio: false, currency: true, linked: false, idem: true }),
    withOptional(core, { portfolio: true, currency: false, linked: true, idem: true }),
    withOptional(core, { portfolio: true, currency: false, linked: false, idem: true }),
    withOptional(core, { portfolio: false, currency: false, linked: true, idem: true }),
    withOptional(core, { portfolio: false, currency: false, linked: false, idem: true }),
    withOptional(core, { portfolio: false, currency: false, linked: false, idem: false }),
    core,
  ];
  return dedupePayloadRows(variants);
}
