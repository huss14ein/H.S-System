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

/**
 * Canonical personal-investment KPI math shared across Dashboard, Investments summary, and reporting.
 * Uses one SAR normalization basis (`sarPerUsd`) and one flow derivation path for consistency.
 */
export function computePersonalInvestmentKpisSar(
  data: FinancialData,
  sarPerUsd: number,
  getAvailableCashForAccount: GetAvailableCashFn,
): PersonalInvestmentKpisSar {
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

  const totalInvestedSarRaw = invTx
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
  const totalInvestedSar =
    totalInvestedSarRaw > 0
      ? totalInvestedSarRaw
      : inferredInvestedFromLedgerSar > 0
        ? inferredInvestedFromLedgerSar
        : fallbackInvestedSar;
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
  };
}
