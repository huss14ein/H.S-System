import type { InvestmentCostLot } from '../types';
import { roundAvgCostPerUnit, roundQuantity } from '../utils/money';

/** Postgres uuid columns reject prefixed ids like `lot-{txId}`. */
export function isCostLotUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id).trim());
}

export function inferLotMarket(symbol: string): InvestmentCostLot['market'] {
  const s = String(symbol ?? '').toUpperCase();
  if (s.endsWith('.SR') || s.endsWith('.SA') || /^\d{4}$/.test(s)) return 'Tadawul';
  if (s.length > 0 && !s.includes('.')) return 'US';
  return 'Other';
}

export function normalizeInvestmentCostLotRow(raw: Record<string, unknown>): InvestmentCostLot {
  const marketRaw = String(raw.market ?? 'Other');
  const market: InvestmentCostLot['market'] =
    marketRaw === 'US' || marketRaw === 'Tadawul' ? marketRaw : 'Other';
  const bookRaw = String(raw.book_currency ?? raw.bookCurrency ?? 'SAR');
  return {
    id: String(raw.id ?? ''),
    user_id: raw.user_id as string | undefined,
    portfolioId: String(raw.portfolio_id ?? raw.portfolioId ?? ''),
    symbol: String(raw.symbol ?? '').toUpperCase(),
    market,
    acquisitionDate: String(raw.acquisition_date ?? raw.acquisitionDate ?? '').slice(0, 10),
    quantityRemaining: roundQuantity(Number(raw.quantity_remaining ?? raw.quantityRemaining ?? 0)),
    costPerShare: roundAvgCostPerUnit(Number(raw.cost_per_share ?? raw.costPerShare ?? 0)),
    bookCurrency: bookRaw === 'USD' ? 'USD' : 'SAR',
    sourceTransactionId:
      (raw.source_transaction_id as string | null) ?? (raw.sourceTransactionId as string | null) ?? null,
    sourceCorporateActionId:
      (raw.source_corporate_action_id as string | null) ??
      (raw.sourceCorporateActionId as string | null) ??
      null,
  };
}

export function investmentCostLotToRow(
  lot: InvestmentCostLot,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    portfolio_id: lot.portfolioId,
    symbol: lot.symbol.toUpperCase(),
    market: lot.market,
    acquisition_date: lot.acquisitionDate.slice(0, 10),
    quantity_remaining: roundQuantity(lot.quantityRemaining),
    cost_per_share: roundAvgCostPerUnit(lot.costPerShare),
    book_currency: lot.bookCurrency,
    source_transaction_id: isCostLotUuid(lot.sourceTransactionId) ? lot.sourceTransactionId : null,
    source_corporate_action_id: isCostLotUuid(lot.sourceCorporateActionId)
      ? lot.sourceCorporateActionId
      : null,
  };
  // Only send id when it is a real UUID — otherwise let Postgres gen_random_uuid().
  if (isCostLotUuid(lot.id)) row.id = lot.id;
  return row;
}

export function costLotToInvestmentCostLot(args: {
  id: string;
  portfolioId: string;
  symbol: string;
  acquisitionDate: string;
  quantityRemaining: number;
  costPerShare: number;
  bookCurrency?: 'SAR' | 'USD';
  sourceTransactionId?: string | null;
  sourceCorporateActionId?: string | null;
}): InvestmentCostLot {
  return {
    id: args.id,
    portfolioId: args.portfolioId,
    symbol: args.symbol.toUpperCase(),
    market: inferLotMarket(args.symbol),
    acquisitionDate: args.acquisitionDate.slice(0, 10),
    quantityRemaining: roundQuantity(args.quantityRemaining),
    costPerShare: roundAvgCostPerUnit(args.costPerShare),
    bookCurrency: args.bookCurrency ?? 'SAR',
    sourceTransactionId: args.sourceTransactionId ?? null,
    sourceCorporateActionId: args.sourceCorporateActionId ?? null,
  };
}
