import { startTransition, useContext, useEffect, useMemo, useState } from 'react';
import type { Account, FinancialData, InvestmentPortfolio } from '../types';
import { DataContext } from '../context/DataContext';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import {
  computePortfolioPeriodPnLSummaryAsync,
  computePortfolioPnLDailySeriesAsync,
  portfolioPeriodPnLMap,
  type PortfolioPeriodPnLSummary,
  type PortfolioPnLDailySeries,
  type PortfolioPeriodPnLRow,
  type PortfolioPnLDailyPoint,
} from '../services/portfolioPeriodPnL';
import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';

type PortfolioPeriodPnLCore = {
  weeklyTotalSar: number;
  weeklySparkline: number[];
  summary: PortfolioPeriodPnLSummary | null;
  dailySeries: PortfolioPnLDailySeries | null;
  ready: boolean;
};

export type PortfolioPeriodPnLSnapshot = PortfolioPeriodPnLCore & {
  pnlByPortfolioId: Map<string, PortfolioPeriodPnLRow>;
  weeklySparklineByPortfolioId: Map<string, PortfolioPnLDailyPoint[]>;
};

const EMPTY_CORE: PortfolioPeriodPnLCore = {
  weeklyTotalSar: 0,
  weeklySparkline: [],
  summary: null,
  dailySeries: null,
  ready: false,
};

/** Deferred portfolio period P/L — summary first, daily series after yield (keeps input responsive). */
export function usePortfolioPeriodPnLSnapshot(args: {
  data: FinancialData | null | undefined;
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  locale?: string;
  /** When false, skips idle scheduling (panel not visible / tab inactive). */
  enabled?: boolean;
}): PortfolioPeriodPnLSnapshot {
  const enabled = args.enabled !== false;
  const { showHydrateBanner, getAvailableCashForAccount } = useContext(DataContext)!;
  const [snapshot, setSnapshot] = useState<PortfolioPeriodPnLCore>(EMPTY_CORE);
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
    if (!enabled) {
      setSnapshot(EMPTY_CORE);
      return;
    }
    if (!data || showHydrateBanner || !getAvailableCashForAccount) {
      setSnapshot(EMPTY_CORE);
      return;
    }

    setSnapshot((prev) => ({ ...prev, ready: false }));
    let aborted = false;
    const cancelIdle = scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused() || aborted) return;

      const monthStartDay = resolveMonthStartDayFromData(data);
      const computeArgs = {
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        monthStartDay,
        getAvailableCashForAccount,
        locale: locale ?? 'en-US',
      };
      const shouldAbort = () => aborted || isBackgroundWorkPaused();

      const summary = await computePortfolioPeriodPnLSummaryAsync(computeArgs, { shouldAbort });
      if (!summary || shouldAbort()) return;

      startTransition(() => {
        setSnapshot({
          weeklyTotalSar: summary.weeklyTotalSar,
          weeklySparkline: [],
          summary,
          dailySeries: null,
          ready: false,
        });
      });

      await yieldToMain(32);
      if (shouldAbort()) return;

      const dailySeries = await computePortfolioPnLDailySeriesAsync(
        { ...computeArgs, summary },
        { shouldAbort },
      );
      if (!dailySeries || shouldAbort()) return;

      startTransition(() => {
        setSnapshot({
          weeklyTotalSar: summary.weeklyTotalSar,
          weeklySparkline: dailySeries.weekly.map((p) => p.cumulativeSar),
          summary,
          dailySeries,
          ready: true,
        });
      });
    }, 1200);

    return () => {
      aborted = true;
      cancelIdle();
    };
  }, [enabled, data, portfolios, accounts, sarPerUsd, simulatedPrices, locale, showHydrateBanner, getAvailableCashForAccount, fingerprint]);

  const pnlByPortfolioId = useMemo(
    () => (snapshot.summary ? portfolioPeriodPnLMap(snapshot.summary) : new Map()),
    [snapshot.summary],
  );
  const weeklySparklineByPortfolioId = useMemo(
    () => snapshot.dailySeries?.weeklyByPortfolioId ?? new Map(),
    [snapshot.dailySeries],
  );

  return { ...snapshot, pnlByPortfolioId, weeklySparklineByPortfolioId };
}
