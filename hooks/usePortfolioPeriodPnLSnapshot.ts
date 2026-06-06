import { useContext, useEffect, useState } from 'react';
import type { Account, FinancialData, InvestmentPortfolio } from '../types';
import { DataContext } from '../context/DataContext';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import {
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
} from '../services/portfolioPeriodPnL';
import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';

export type PortfolioPeriodPnLSnapshot = {
  weeklyTotalSar: number;
  weeklySparkline: number[];
};

const EMPTY: PortfolioPeriodPnLSnapshot = { weeklyTotalSar: 0, weeklySparkline: [] };

/** Deferred portfolio period P/L — avoids blocking Wealth Analytics route paint. */
export function usePortfolioPeriodPnLSnapshot(args: {
  data: FinancialData | null | undefined;
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  locale?: string;
}): PortfolioPeriodPnLSnapshot {
  const { showHydrateBanner, getAvailableCashForAccount } = useContext(DataContext)!;
  const [snapshot, setSnapshot] = useState<PortfolioPeriodPnLSnapshot>(EMPTY);
  const { data, portfolios, accounts, sarPerUsd, simulatedPrices, locale } = args;

  const fingerprint = [
    data?.accounts?.length ?? 0,
    data?.transactions?.length ?? 0,
    data?.investmentTransactions?.length ?? 0,
    portfolios.length,
    Object.keys(simulatedPrices).length,
    sarPerUsd,
  ].join(':');

  useEffect(() => {
    if (!data || showHydrateBanner || !getAvailableCashForAccount) {
      setSnapshot(EMPTY);
      return;
    }

    return scheduleIdleWork(() => {
      if (isBackgroundWorkPaused()) return;
      const monthStartDay = resolveMonthStartDayFromData(data);
      const summary = computePortfolioPeriodPnLSummary({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        monthStartDay,
        getAvailableCashForAccount,
      });
      const daily = computePortfolioPnLDailySeries({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        monthStartDay,
        getAvailableCashForAccount,
        locale: locale ?? 'en-US',
      });
      setSnapshot({
        weeklyTotalSar: summary.weeklyTotalSar,
        weeklySparkline: daily.weekly.map((p) => p.cumulativeSar),
      });
    }, 1200);
  }, [data, portfolios, accounts, sarPerUsd, simulatedPrices, locale, showHydrateBanner, getAvailableCashForAccount, fingerprint]);

  return snapshot;
}
