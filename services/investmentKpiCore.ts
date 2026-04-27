import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { getAllInvestmentsValueInSAR, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { inferInvestmentTransactionCurrency, resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';

type GetAvailableCashFn = (accountId: string) => { SAR?: number; USD?: number } | null | undefined;

export type PersonalInvestmentKpisSar = {
  holdingsValueSar: number;
  brokerageCashSar: number;
  totalInvestmentsValueSar: number;
  totalInvestedSar: number;
  totalWithdrawnSar: number;
  netCapitalSar: number;
  totalGainLossSar: number;
  roi: number;
};

export type InvestmentCapitalSource = 'deposits' | 'ledger_inferred' | 'cost_basis_fallback';

/**
 * When deposits are missing we infer capital from buys/sells/dividends/cash — fragile if buy history is incomplete.
 * Cross-check against avg-cost fallback (holdings basis + broker cash + withdrawals): if inferred diverges wildly,
 * prefer cost_basis_fallback instead of overstating or understating invested capital.
 */
export const LEDGER_INFERRED_FALLBACK_MIN_RATIO = 0.22;
export const LEDGER_INFERRED_FALLBACK_MAX_RATIO = 4.5;
/** Skip ratio cross-check when fallback gross is tiny (noise vs rounding). */
export const LEDGER_INFERRED_FALLBACK_MIN_SAR = 400;

export type PersonalInvestmentKpiBreakdown = PersonalInvestmentKpisSar & {
  capitalSource: InvestmentCapitalSource;
  /** Sum of deposit transactions (SAR). */
  depositsRecordedSar: number;
  /** Used only when deposits are missing: max(0, buys − sells − dividends + brokerageCash + withdrawals). */
  inferredInvestedFromLedgerSar: number;
  /** Rolling average-cost basis of open holdings (SAR). */
  holdingsCostBasisSar: number;
  /** Used when deposits and inferred path are zero: max(0, holdingsCostBasisSar + brokerageCashSar + totalWithdrawnSar). */
  fallbackInvestedSar: number;
  buysSar: number;
  sellsSar: number;
  dividendsSar: number;
  feesSar: number;
  vatSar: number;
};

/**
 * Canonical personal-investment KPI math shared across Dashboard, Investments summary, and reporting.
 * Uses one SAR normalization basis (`sarPerUsd`) and one flow derivation path for consistency.
 */
export function computePersonalInvestmentKpiBreakdown(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
): PersonalInvestmentKpiBreakdown {
  const d = data as FinancialData & {
    personalAccounts?: Account[];
    personalInvestments?: InvestmentPortfolio[];
  };
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const investments = (d.personalInvestments ?? data.investments ?? []) as InvestmentPortfolio[];
  const personalAccountIds = new Set(accounts.map((a) => a.id));

  const holdingsValueSar = getAllInvestmentsValueInSAR(investments, sarPerUsd);
  let brokerageCashSar = 0;
  for (const account of accounts) {
    if (account.type !== 'Investment' || !personalAccountIds.has(account.id)) continue;
    const cash = getAvailableCashForAccount(account.id);
    brokerageCashSar += tradableCashBucketToSAR({ SAR: cash?.SAR ?? 0, USD: cash?.USD ?? 0 }, sarPerUsd);
  }
  const totalInvestmentsValueSar = holdingsValueSar + brokerageCashSar;

  const txHitsPersonalInvestment = (t: InvestmentTransaction) => {
    const accountId = resolveInvestmentTransactionAccountId(
      t as InvestmentTransaction & { account_id?: string; portfolio_id?: string },
      accounts,
      investments,
    );
    return !!accountId && personalAccountIds.has(accountId);
  };
  const invTx = (data.investmentTransactions ?? []).filter((t) => txHitsPersonalInvestment(t as InvestmentTransaction)) as InvestmentTransaction[];
  const invTxSar = (t: InvestmentTransaction) =>
    investmentTransactionCashAmountSarDated({
      tx: t,
      accounts,
      portfolios: investments,
      data,
      uiExchangeRate: sarPerUsd,
    }) || toSAR(getInvestmentTransactionCashAmount(t as any), inferInvestmentTransactionCurrency(t as any, accounts, investments), sarPerUsd);

  const depositsRecordedSar = invTx
    .filter((t) => isInvestmentTransactionType(t.type, 'deposit'))
    .reduce((sum, t) => sum + invTxSar(t), 0);
  const totalWithdrawnSar = invTx
    .filter((t) => isInvestmentTransactionType(t.type, 'withdrawal'))
    .reduce((sum, t) => sum + invTxSar(t), 0);
  const buysSar = invTx
    .filter((t) => isInvestmentTransactionType(t.type, 'buy'))
    .reduce((sum, t) => sum + invTxSar(t), 0);
  const sellsSar = invTx
    .filter((t) => isInvestmentTransactionType(t.type, 'sell'))
    .reduce((sum, t) => sum + invTxSar(t), 0);
  const dividendsSar = invTx
    .filter((t) => isInvestmentTransactionType(t.type, 'dividend'))
    .reduce((sum, t) => sum + invTxSar(t), 0);
  const feesSar = invTx.filter((t) => isInvestmentTransactionType(t.type, 'fee')).reduce((sum, t) => sum + invTxSar(t), 0);
  const vatSar = invTx.filter((t) => isInvestmentTransactionType(t.type, 'vat')).reduce((sum, t) => sum + invTxSar(t), 0);

  /**
   * Heuristic when deposit history is empty: approximates “funds committed” from net purchases and
   * live cash (floored per currency). Withdrawals appear inside this expression and net capital applies
   * withdrawals again — see System Health breakdown for cancellation intuition.
   */
  const inferredInvestedFromLedgerSar = Math.max(0, buysSar - sellsSar - dividendsSar + brokerageCashSar + totalWithdrawnSar);
  const holdingsCostBasisSar = investments.reduce((sum: number, portfolio: InvestmentPortfolio) => {
    const book: 'USD' | 'SAR' = portfolio?.currency === 'USD' ? 'USD' : 'SAR';
    const cost = (portfolio.holdings ?? []).reduce((s: number, h: Holding) => {
      const avg = Number(h?.avgCost ?? 0);
      const qty = Number(h?.quantity ?? 0);
      if (!(avg > 0) || !(qty > 0)) return s;
      return s + avg * qty;
    }, 0);
    return sum + toSAR(cost, book, sarPerUsd);
  }, 0);
  const fallbackInvestedSar = Math.max(0, holdingsCostBasisSar + brokerageCashSar + totalWithdrawnSar);

  let capitalSource: InvestmentCapitalSource = 'cost_basis_fallback';
  let totalInvestedSar = fallbackInvestedSar;
  if (depositsRecordedSar > 0) {
    capitalSource = 'deposits';
    totalInvestedSar = depositsRecordedSar;
  } else if (inferredInvestedFromLedgerSar > 0) {
    const fallbackMeaningful = fallbackInvestedSar >= LEDGER_INFERRED_FALLBACK_MIN_SAR;
    const ratioOk =
      !fallbackMeaningful ||
      (inferredInvestedFromLedgerSar >= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MIN_RATIO &&
        inferredInvestedFromLedgerSar <= fallbackInvestedSar * LEDGER_INFERRED_FALLBACK_MAX_RATIO);
    if (ratioOk) {
      capitalSource = 'ledger_inferred';
      totalInvestedSar = inferredInvestedFromLedgerSar;
    }
  }

  const netCapitalSar = Math.max(0, totalInvestedSar - totalWithdrawnSar);
  const totalGainLossSar = totalInvestmentsValueSar - netCapitalSar;
  const roi = netCapitalSar > 0 ? totalGainLossSar / netCapitalSar : 0;

  return {
    holdingsValueSar,
    brokerageCashSar,
    totalInvestmentsValueSar,
    totalInvestedSar,
    totalWithdrawnSar,
    netCapitalSar,
    totalGainLossSar,
    roi,
    capitalSource,
    depositsRecordedSar,
    inferredInvestedFromLedgerSar,
    holdingsCostBasisSar,
    fallbackInvestedSar,
    buysSar,
    sellsSar,
    dividendsSar,
    feesSar,
    vatSar,
  };
}

export function computePersonalInvestmentKpisSar(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
): PersonalInvestmentKpisSar {
  const b = computePersonalInvestmentKpiBreakdown(data, sarPerUsd, getAvailableCashForAccount);
  return {
    holdingsValueSar: b.holdingsValueSar,
    brokerageCashSar: b.brokerageCashSar,
    totalInvestmentsValueSar: b.totalInvestmentsValueSar,
    totalInvestedSar: b.totalInvestedSar,
    totalWithdrawnSar: b.totalWithdrawnSar,
    netCapitalSar: b.netCapitalSar,
    totalGainLossSar: b.totalGainLossSar,
    roi: b.roi,
  };
}
