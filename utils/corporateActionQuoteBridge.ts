/** Bridge so DataContext can nudge MarketDataContext to split-adjust cached quotes after corporate actions. */
import type { CorporateAction } from '../services/corporateActions';

export type CorporateActionQuoteAdjustFn = (args: {
  symbol: string;
  action: CorporateAction;
  portfolioId?: string;
}) => void;

let adjustQuotesFn: CorporateActionQuoteAdjustFn | null = null;

export function registerCorporateActionQuoteAdjust(fn: CorporateActionQuoteAdjustFn | null): void {
  adjustQuotesFn = fn;
}

export function adjustQuotesForCorporateActionNow(args: {
  symbol: string;
  action: CorporateAction;
  portfolioId?: string;
}): void {
  adjustQuotesFn?.(args);
}
