/**
 * Single-scope and hybrid investment capital resolution (deposits − withdrawals vs incomplete-books floor).
 * Shared by headline ROI (`investmentKpiCore`) and platform/portfolio cards (`investmentPlatformCardMetrics`).
 */
import { HEADLINE_NEAR_ZERO_NET_INVESTED_SAR } from './investmentCapitalAge';

export type InvestmentCapitalSource =
  | 'deposits'
  | 'ledger_inferred'
  | 'cost_basis_fallback'
  /** Some sleeves use deposits − withdrawals; others floor at cost + cash (incomplete books). */
  | 'mixed'
  /**
   * Manual-price (`manual_fund`) sleeve: net invested floors at holdings cost + cash even when
   * some deposits exist, so self-reported marks cannot invent deposit-based ROI.
   * Live quote portfolios never use this path.
   */
  | 'manual_marks';

/**
 * When deposits are missing we infer capital from buys/sells/dividends/cash — fragile if buy history is incomplete.
 * Cross-check against avg-cost fallback (holdings basis + broker cash + withdrawals): if inferred diverges wildly,
 * prefer cost_basis_fallback instead of overstating or understating invested capital.
 */
export const LEDGER_INFERRED_FALLBACK_MIN_RATIO = 0.22;
export const LEDGER_INFERRED_FALLBACK_MAX_RATIO = 4.5;
/** Skip ratio cross-check when fallback gross is tiny (noise vs rounding). */
export const LEDGER_INFERRED_FALLBACK_MIN_SAR = 400;

/**
 * Manual-price books: if present value exceeds this multiple of net invested, treat marks as
 * unreliable without live quotes (e.g. 73k PV on 2.5k deposits → hide ROI). Live books ignore this.
 */
export const MANUAL_MARKS_MAX_PV_TO_NET_RATIO = 5;

/** Investor-facing definition for ROI / net invested (headline + platform cards + AI). */
export function describeInvestmentNetInvested(capitalSource: InvestmentCapitalSource): string {
  switch (capitalSource) {
    case 'mixed':
      return 'Net invested is hybrid: funded portfolios use deposits − withdrawals; portfolios without deposit/withdrawal history floor at holdings cost + idle cash so their market value is not treated as free profit.';
    case 'ledger_inferred':
      return 'Net invested is inferred from buys/sells/dividends and cash when deposit history is missing, floored at holdings cost + idle cash when books look incomplete.';
    case 'cost_basis_fallback':
      return 'Net invested uses holdings cost basis + idle broker cash because deposit/withdrawal history was never recorded.';
    case 'manual_marks':
      return 'This book uses manual holding prices. Net invested floors at your purchase cost + idle cash (not deposit-only ROI), so live quote portfolios stay on the deposits path.';
    case 'deposits':
    default:
      return 'Net invested is deposits − withdrawals (reconcile cash stamps excluded), plus commodity/Sukuk purchase costs on the headline. Cost basis is used only when deposit history is missing.';
  }
}

/** Short footer / subtitle for net invested when capital source is known. */
export function netInvestedSubtitle(capitalSource: InvestmentCapitalSource): string {
  switch (capitalSource) {
    case 'mixed':
      return 'Hybrid: deposits on funded sleeves + cost floor on incomplete books';
    case 'ledger_inferred':
      return 'Ledger-inferred (incomplete deposit history)';
    case 'cost_basis_fallback':
      return 'Cost basis + cash (no deposit history)';
    case 'manual_marks':
      return 'Manual prices · cost + cash floor';
    case 'deposits':
    default:
      return 'Deposits − withdrawals';
  }
}

export type ScopedInvestmentCapitalResult = {
  capitalSource: Exclude<InvestmentCapitalSource, 'mixed'>;
  totalInvestedSar: number;
  netCapitalSar: number;
  economicFloorApplied: boolean;
  inferredInvestedFromLedgerSar: number;
  fallbackInvestedSar: number;
  /**
   * Manual marks with no purchase cost / buy history — ROI must not use deposit-only math.
   * Callers neutralize gain (net ≈ present value) and suppress ROI display.
   */
  manualMarksInvestedHistoryIncomplete?: boolean;
};

/**
 * Single-scope capital (one portfolio or one platform treated as one book):
 * deposits − withdrawals when funding exists; otherwise ledger-inferred / cost+cash with incomplete-books floor.
 * Manual-price sleeves always floor at cost + cash and never invent deposit-only ROI when cost history is missing.
 */
export function resolveScopedInvestmentCapitalSar(args: {
  depositsRecordedSar: number;
  withdrawnSar: number;
  holdingsCostBasisSar: number;
  cashSar: number;
  buysSar?: number;
  sellsSar?: number;
  dividendsSar?: number;
  /** When true (default), reject wild ledger-inferred vs cost-basis ratios. */
  applyLedgerInferredRatioGuard?: boolean;
  /**
   * True when every open holding is `manual_fund` (no live quotes).
   * Live quote portfolios must leave this false/undefined.
   */
  manualMarksOnly?: boolean;
}): ScopedInvestmentCapitalResult {
  const deposits = Math.max(0, Number.isFinite(args.depositsRecordedSar) ? args.depositsRecordedSar : 0);
  const withdrawn = Math.max(0, Number.isFinite(args.withdrawnSar) ? args.withdrawnSar : 0);
  const cost = Math.max(0, Number.isFinite(args.holdingsCostBasisSar) ? args.holdingsCostBasisSar : 0);
  const cash = Math.max(0, Number.isFinite(args.cashSar) ? args.cashSar : 0);
  const buys = Math.max(0, Number.isFinite(args.buysSar) ? args.buysSar! : 0);
  const sells = Math.max(0, Number.isFinite(args.sellsSar) ? args.sellsSar! : 0);
  const dividends = Math.max(0, Number.isFinite(args.dividendsSar) ? args.dividendsSar! : 0);
  const applyGuard = args.applyLedgerInferredRatioGuard !== false;
  const manualMarksOnly = args.manualMarksOnly === true;

  const inferredInvestedFromLedgerSar = Math.max(0, buys - sells - dividends + cash + withdrawn);
  const fallbackInvestedSar = Math.max(0, cost + cash + withdrawn);
  const economicDeployedSar = Math.max(0, cost + cash);

  /**
   * Manual marks: typed avgCost alone is not “invested history” (users often set cost/current value
   * without buy ledger rows). Require buy history so deposit-only + fantasy marks cannot show 1000%+ ROI.
   * Live quote path below is unchanged.
   */
  const investedHistoryReliable = buys > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR;

  if (manualMarksOnly) {
    const depositNet = deposits > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR ? Math.max(0, deposits - withdrawn) : 0;
    if (!investedHistoryReliable) {
      return {
        capitalSource: 'manual_marks',
        // Keep recorded deposits as “invested” for display; incomplete books suppress ROI separately.
        totalInvestedSar: deposits > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR ? deposits : fallbackInvestedSar,
        netCapitalSar: Math.max(depositNet, economicDeployedSar),
        economicFloorApplied: true,
        inferredInvestedFromLedgerSar,
        fallbackInvestedSar,
        manualMarksInvestedHistoryIncomplete: true,
      };
    }
    const netCapitalSar = Math.max(depositNet, economicDeployedSar);
    return {
      capitalSource: 'manual_marks',
      totalInvestedSar: deposits > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR ? deposits : fallbackInvestedSar,
      netCapitalSar,
      economicFloorApplied: netCapitalSar > depositNet + 1e-9,
      inferredInvestedFromLedgerSar,
      fallbackInvestedSar,
      manualMarksInvestedHistoryIncomplete: false,
    };
  }

  if (deposits > HEADLINE_NEAR_ZERO_NET_INVESTED_SAR) {
    const totalInvestedSar = deposits;
    const ledgerNet = Math.max(0, totalInvestedSar - withdrawn);
    return {
      capitalSource: 'deposits',
      totalInvestedSar,
      netCapitalSar: ledgerNet,
      economicFloorApplied: false,
      inferredInvestedFromLedgerSar,
      fallbackInvestedSar,
    };
  }

  let capitalSource: Exclude<InvestmentCapitalSource, 'mixed'> = 'cost_basis_fallback';
  let totalInvestedSar = fallbackInvestedSar;
  if (inferredInvestedFromLedgerSar > 0) {
    const fallbackMeaningful = fallbackInvestedSar >= LEDGER_INFERRED_FALLBACK_MIN_SAR;
    const ratioOk =
      !applyGuard ||
      !fallbackMeaningful ||
      (inferredInvestedFromLedgerSar >= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MIN_RATIO &&
        inferredInvestedFromLedgerSar <= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MAX_RATIO);
    if (ratioOk) {
      capitalSource = 'ledger_inferred';
      totalInvestedSar = inferredInvestedFromLedgerSar;
    }
  }

  const ledgerNet = Math.max(0, totalInvestedSar - withdrawn);
  const netCapitalSar = Math.max(ledgerNet, economicDeployedSar);
  return {
    capitalSource,
    totalInvestedSar,
    netCapitalSar,
    economicFloorApplied: netCapitalSar > ledgerNet + 1e-9,
    inferredInvestedFromLedgerSar,
    fallbackInvestedSar,
  };
}

/** Merge per-sleeve capital sources for headline / System Health. */
export function aggregateInvestmentCapitalSources(
  sources: InvestmentCapitalSource[],
): InvestmentCapitalSource {
  const uniq = [...new Set(sources.filter(Boolean))];
  if (uniq.length === 0) return 'cost_basis_fallback';
  if (uniq.length === 1) return uniq[0]!;
  if (uniq.includes('mixed')) return 'mixed';
  return 'mixed';
}

/**
 * Headline platform capital: deposits − withdrawals when funding history exists.
 * Cost-basis + idle cash is a floor only when deposits are missing (incomplete books).
 * Manual-marks and mixed books already carry floors — pass through without re-flooring.
 */
export function resolveHeadlinePlatformNetCapitalSar(args: {
  capitalSource: InvestmentCapitalSource;
  ledgerNetCapitalSar: number;
  economicDeployedSar: number;
}): { platformNetSar: number; economicFloorApplied: boolean } {
  const ledger = Math.max(0, Number.isFinite(args.ledgerNetCapitalSar) ? args.ledgerNetCapitalSar : 0);
  const economic = Math.max(0, Number.isFinite(args.economicDeployedSar) ? args.economicDeployedSar : 0);
  if (
    args.capitalSource === 'deposits' ||
    args.capitalSource === 'mixed' ||
    args.capitalSource === 'manual_marks'
  ) {
    return {
      platformNetSar: ledger,
      economicFloorApplied: args.capitalSource === 'mixed' || args.capitalSource === 'manual_marks',
    };
  }
  const platformNetSar = Math.max(ledger, economic);
  return {
    platformNetSar,
    economicFloorApplied: platformNetSar > ledger + 1e-9,
  };
}
