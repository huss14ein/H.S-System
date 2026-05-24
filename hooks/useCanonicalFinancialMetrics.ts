import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketData } from '../context/MarketDataContext';
import {
  computePersonalHeadlineNetWorthSar,
  computeTodayBalanceSheetSnapshotSar,
  type PersonalHeadlineNetWorthResult,
  type PersonalNetWorthOptions,
  type TodayBalanceSheetSnapshotSAR,
} from '../services/personalNetWorth';
import { computeDashboardKpiSnapshot, type DashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import {
  buildInvestableCashBarsFromInvestmentAccounts,
  type InvestableCashBarRow,
} from '../services/investmentCashLedger';
import { getPersonalAccounts } from '../utils/wealthScope';

/** Canonical personal NW + Dashboard KPI inputs (UI exchange rate + live quotes). */
export function useCanonicalFinancialMetrics() {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();

  const nwOptions: PersonalNetWorthOptions | undefined = useMemo(
    () =>
      getAvailableCashForAccount
        ? { getAvailableCashForAccount, simulatedPrices }
        : undefined,
    [getAvailableCashForAccount, simulatedPrices],
  );

  const headline = useMemo((): PersonalHeadlineNetWorthResult => {
    return computePersonalHeadlineNetWorthSar(data, exchangeRate, nwOptions);
  }, [data, exchangeRate, nwOptions]);

  const kpiSnapshot = useMemo((): DashboardKpiSnapshot | null => {
    if (!data || !getAvailableCashForAccount) return null;
    return computeDashboardKpiSnapshot(data, exchangeRate, getAvailableCashForAccount, simulatedPrices);
  }, [data, exchangeRate, getAvailableCashForAccount, simulatedPrices]);

  const wealthSummary = useMemo(() => {
    if (!data || !getAvailableCashForAccount) return null;
    return computeWealthSummaryReportModel(data, exchangeRate, getAvailableCashForAccount, simulatedPrices);
  }, [data, exchangeRate, getAvailableCashForAccount, simulatedPrices]);

  const todaySnapshot = useMemo((): TodayBalanceSheetSnapshotSAR => {
    return computeTodayBalanceSheetSnapshotSar(data, exchangeRate, nwOptions);
  }, [data, exchangeRate, nwOptions]);

  const investableCashBars = useMemo((): InvestableCashBarRow[] => {
    if (!data) return [];
    const scope = getPersonalAccounts(data);
    const allAccounts = data.accounts ?? scope;
    return buildInvestableCashBarsFromInvestmentAccounts(scope, allAccounts, headline.sarPerUsd);
  }, [data, headline.sarPerUsd]);

  return {
    data,
    exchangeRate,
    simulatedPrices,
    getAvailableCashForAccount,
    nwOptions,
    headline,
    kpiSnapshot,
    wealthSummary,
    todaySnapshot,
    investableCashBars,
    sarPerUsd: headline.sarPerUsd,
    netWorth: headline.netWorth,
    buckets: headline.buckets,
    liquidCashSar: kpiSnapshot?.liquidCashSar ?? 0,
  };
}
