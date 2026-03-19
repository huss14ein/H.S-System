import React, { useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { buyScore, sellScore } from '../services/decisionEngine';
import { loadTradingPolicy } from '../services/tradingPolicy';
import {
  listNetWorthSnapshots,
  compareSnapshots,
  restoreHistoricalView,
  lockMonthEnd,
  isMonthLocked,
  createMonthlySnapshot,
} from '../services/netWorthSnapshot';
import { approximatePortfolioMWRR, flowsFromInvestmentTransactions } from '../services/portfolioXirr';
import { attributeNetWorthWithFlows } from '../services/portfolioAttribution';
import { personalNetCashflowBetween } from '../services/netWorthPeriodFlows';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import {
  dailyReviewChecklist,
  weeklyReviewChecklist,
  monthlyCloseProcess,
  quarterlyStrategyReview,
  annualResetWorkflow,
} from '../services/reviewWorkflowEngine';
import { debtStressScore } from '../services/debtEngines';
import { detectStaleMarketData } from '../services/dataQuality';
import { MarketDataContext } from '../context/MarketDataContext';
import { useCurrency } from '../context/CurrencyContext';
import type { Page, Transaction } from '../types';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { countsAsIncomeForCashflowKpi } from '../services/transactionFilters';

const RiskTradingHub: React.FC<{ setActivePage?: (p: Page) => void }> = ({ setActivePage }) => {
  const { data, loading } = useContext(DataContext)!;
  const marketData = useContext(MarketDataContext);
  const ef = useEmergencyFund(data ?? null);
  const { formatCurrencyString } = useFormatCurrency();
  const [policy, setPolicy] = useState(() => loadTradingPolicy());
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') setPolicy(loadTradingPolicy());
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const [snapshotRefresh, setSnapshotRefresh] = useState(0);
  const snaps = useMemo(() => listNetWorthSnapshots(), [data?.accounts?.length, snapshotRefresh]);

  const [compareFrom, setCompareFrom] = useState<string>('');
  const [compareTo, setCompareTo] = useState<string>('');
  const [restoreDate, setRestoreDate] = useState<string>('');
  const [lockYearMonth, setLockYearMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const snapshotDates = useMemo(() => snaps.map((s) => s.at.slice(0, 10)), [snaps]);
  const fillLastTwoSnapshots = useCallback(() => {
    const uniq = [...new Set(snapshotDates)].sort((a, b) => a.localeCompare(b));
    if (uniq.length >= 2) {
      setCompareFrom(uniq[uniq.length - 2]!);
      setCompareTo(uniq[uniq.length - 1]!);
    }
  }, [snapshotDates]);
  const compareResult = useMemo(() => {
    if (!compareFrom || !compareTo || snaps.length === 0) return null;
    return compareSnapshots(snaps, compareFrom, compareTo);
  }, [snaps, compareFrom, compareTo]);
  const restoredSnapshot = useMemo(() => {
    if (!restoreDate || snaps.length === 0) return null;
    return restoreHistoricalView(snaps, restoreDate);
  }, [snaps, restoreDate]);

  const { exchangeRate } = useCurrency();
  const currentNetWorth = useMemo(() => computePersonalNetWorthSAR(data ?? null, exchangeRate), [data, exchangeRate]);

  const reviewInputs = useMemo(() => {
    const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
    const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
    const liabilities = (data as any)?.personalLiabilities ?? data?.liabilities ?? [];
    const uncategorized = txs.filter((t) => t.type === 'expense' && !t.budgetCategory).length;
    const liquid = accounts.filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, a.balance ?? 0), 0);
    const monthlyDebt = liabilities.filter((l: { status?: string }) => l.status === 'Active').reduce((s: number, l: { monthlyPayment?: number }) => s + (l.monthlyPayment ?? 0), 0);
    const sixMoAgo = new Date(); sixMoAgo.setMonth(sixMoAgo.getMonth() - 6);
    const incomeSum = txs
      .filter((t: Transaction) => countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= sixMoAgo)
      .reduce((s: number, t: Transaction) => s + (Number(t.amount) ?? 0), 0);
    const grossMonthlyIncome = incomeSum / 6 || 1;
    const debtStress = debtStressScore(monthlyDebt, grossMonthlyIncome, liquid);
    const staleSummary = detectStaleMarketData(marketData?.lastUpdated ?? null, marketData?.isLive ?? false);
    return {
      hasStaleMarketData: staleSummary.isStale,
      debtStressScore: debtStress.score,
      isUncategorizedSpend: uncategorized > 0,
      budgetVariancePct: undefined as number | undefined,
      missingBudgetCategories: uncategorized > 0,
      shouldSnapshot: true,
    };
  }, [data, marketData?.lastUpdated, marketData?.isLive]);

  const dailyItems = useMemo(() => dailyReviewChecklist({ hasStaleMarketData: reviewInputs.hasStaleMarketData, debtStressScore: reviewInputs.debtStressScore }), [reviewInputs.hasStaleMarketData, reviewInputs.debtStressScore]);
  const weeklyItems = useMemo(() => weeklyReviewChecklist({ budgetVariancePct: reviewInputs.budgetVariancePct, isUncategorizedSpend: reviewInputs.isUncategorizedSpend }), [reviewInputs.budgetVariancePct, reviewInputs.isUncategorizedSpend]);
  const monthlyItems = useMemo(() => monthlyCloseProcess({ shouldSnapshot: reviewInputs.shouldSnapshot, missingBudgetCategories: reviewInputs.missingBudgetCategories }), [reviewInputs.shouldSnapshot, reviewInputs.missingBudgetCategories]);
  const quarterlyItems = useMemo(() => quarterlyStrategyReview(), []);
  const annualItems = useMemo(() => annualResetWorkflow(), []);

  const mwrr = useMemo(() => {
    const txs = data?.investmentTransactions ?? [];
    const flows = flowsFromInvestmentTransactions(txs as { date: string; type: string; total?: number }[]);
    const inv = (data as any)?.personalInvestments ?? data?.investments ?? [];
    let tv = 0;
    inv.forEach((p: { holdings?: { currentValue?: number }[] }) => {
      (p.holdings ?? []).forEach((h: { currentValue?: number }) => {
        tv += Number(h.currentValue) || 0;
      });
    });
    const r = approximatePortfolioMWRR(flows, tv, new Date().toISOString().slice(0, 10));
    return r;
  }, [data]);

  const attr = useMemo(() => {
    if (snaps.length < 2) return null;
    const a = snaps[1];
    const b = snaps[0];
    const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
    const flow = personalNetCashflowBetween(txs, a.at, b.at);
    return attributeNetWorthWithFlows({
      startNw: a.netWorth,
      endNw: b.netWorth,
      externalCashflow: flow,
    });
  }, [snaps, data]);

  const buyS = buyScore({ emergencyFundMonths: ef.monthsCovered, runwayMonths: ef.monthsCovered });
  const sellS = sellScore({ aboveTargetWeightPct: 8, needCash: true });

  if (loading || !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-spin h-10 w-10 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PageLayout
      title="Risk & trading hub"
      description="Policy, scores, and net worth snapshots update from your data automatically. Checklists refresh from live metrics (stale quotes, debt stress, uncategorized spend). Educational only—not financial advice."
    >
      {setActivePage && (
        <p className="text-sm text-slate-600 mb-4">
          <button type="button" className="text-primary-600 font-medium underline" onClick={() => setActivePage('Logic & Engines')}>
            Logic & Engines
          </button>{' '}
          — returns, cash/FX, retirement, probabilistic planning, cross-engine integration (all wired to your data).
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          title="Emergency runway"
          infoHint="Months of essential expenses covered by checking + savings (positive balances). From the same emergency fund logic as Goals and Dashboard."
        >
          <p className="text-2xl font-bold text-slate-900">{ef.monthsCovered.toFixed(1)} mo</p>
          <p className="text-sm text-slate-600">Coverage vs {ef.targetMonths} mo target</p>
        </SectionCard>
        <SectionCard
          title="Sample scores (rules)"
          infoHint="buyScore / sellScore from decisionEngine using your runway and sample position/cash needs. Tune gates in Settings → trading policy."
        >
          <p className="text-sm">
            Buy-score: <strong className="text-primary">{buyS}</strong> / 100 · Sell sample:{' '}
            <strong className="text-rose-700">{sellS.score}</strong> ({sellS.reasons.join(', ')})
          </p>
        </SectionCard>
        <SectionCard
          title="Trading policy (this device)"
          infoHint="Stored in browser localStorage per device. Edit in Settings; Record Trade uses these rules for warnings."
        >
          <ul className="text-sm text-slate-700 space-y-1">
            <li>Min runway for buys: {policy.minRunwayMonthsToAllowBuys} mo</li>
            <li>Max position weight: {policy.maxPositionWeightPct}%</li>
            <li>Block buys if 30d net negative: {policy.blockBuysIfMonthlyNetNegative ? 'Yes' : 'No'}</li>
            <li>Large sell ack over: {formatCurrencyString(policy.requireAckLargeSellNotional, { digits: 0 })}</li>
          </ul>
          {setActivePage && (
            <button type="button" className="btn-outline text-sm mt-3" onClick={() => setActivePage('Settings')}>
              Edit in Settings
            </button>
          )}
        </SectionCard>
        <SectionCard
          title="Approx. MWRR (cashflows)"
          infoHint="Money-weighted style return from investment buy/sell flows and current holdings value. Simplified; not a certified performance report."
        >
          <p className="text-2xl font-bold">{mwrr != null ? `${mwrr.toFixed(2)}%` : '—'}</p>
          <p className="text-xs text-slate-500">Simplified IRR on deposits/withdrawals + terminal value. Not audited.</p>
        </SectionCard>
      </div>
      <SectionCard
        title="Net worth attribution (Dashboard snapshots)"
        className="mt-4"
        infoHint="Needs two local snapshots (newest vs previous in list). Explains NW change as personal cashflows vs residual (markets, debt, other). Create snapshots from Dashboard (admin) or below."
      >
        {attr ? (
          <>
            <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside">
              {attr.bullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-3">
              Cashflow is from personal transactions between snapshot times; residual captures markets, debt, and non-cash items. Also on <strong>Summary</strong> (admin).
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Need <strong>two</strong> local net worth snapshots. Visit <strong>Dashboard</strong> as admin on two different days—each visit updates today&apos;s snapshot. Then return here for flows vs residual.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Snapshots & history"
        className="mt-4"
        infoHint="Snapshots are saved on this device. “Create snapshot now” stores today’s computed net worth. Use “Fill last 2 dates” to auto-select the two most recent snapshot days for compare."
      >
        <p className="text-sm text-slate-600 mb-3">Compare two snapshots, view net worth as of a date, or lock a month (no further edits to that month).</p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => {
              const nw = currentNetWorth;
              if (typeof nw === 'number' && Number.isFinite(nw)) {
                createMonthlySnapshot(nw);
                setCompareFrom('');
                setCompareTo('');
                setRestoreDate('');
                setSnapshotRefresh((r) => r + 1);
              }
            }}
          >
            Create snapshot now
          </button>
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={fillLastTwoSnapshots}
            disabled={snapshotDates.length < 2}
            title={snapshotDates.length < 2 ? 'Need at least two snapshot dates' : 'Set compare from/to to the two latest dates'}
          >
            Fill last 2 snapshot dates
          </button>
          <span className="text-xs text-slate-500">Current NW: {formatCurrencyString(Number.isFinite(currentNetWorth) ? (currentNetWorth ?? 0) : 0, { digits: 0 })}</span>
        </div>
        {snaps.length === 0 ? (
          <p className="text-sm text-slate-500">No snapshots yet. Create one above or visit Dashboard as admin to record today&apos;s net worth.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Compare: from</label>
                <select className="input-base w-full" value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)}>
                  <option value="">Select date</option>
                  {snapshotDates.map((d, i) => (
                    <option key={`${d}-${i}`} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">to</label>
                <select className="input-base w-full" value={compareTo} onChange={(e) => setCompareTo(e.target.value)}>
                  <option value="">Select date</option>
                  {snapshotDates.map((d, i) => (
                    <option key={`${d}-${i}`} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            {compareResult != null && (
              <p className="text-sm text-slate-800">
                Change: <strong className={compareResult.change >= 0 ? 'text-green-700' : 'text-red-700'}>{formatCurrencyString(compareResult.change, { digits: 0 })}</strong>
                {' '}({compareResult.fromNw.toFixed(0)} → {compareResult.toNw.toFixed(0)})
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Restore view (as of date)</label>
                <input type="date" className="input-base w-full max-w-[180px]" value={restoreDate} onChange={(e) => setRestoreDate(e.target.value)} />
              </div>
              {restoredSnapshot && (
                <p className="text-sm text-slate-800">NW as of {restoredSnapshot.at.slice(0, 10)}: <strong>{formatCurrencyString(restoredSnapshot.netWorth, { digits: 0 })}</strong></p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
              <label className="block text-xs font-semibold text-slate-600">Lock month (YYYY-MM)</label>
              <input type="month" className="input-base w-36" value={lockYearMonth} onChange={(e) => setLockYearMonth(e.target.value)} />
              <button type="button" className="btn-outline text-sm" onClick={() => lockYearMonth && lockMonthEnd(lockYearMonth)}>Lock month</button>
              {lockYearMonth && isMonthLocked(lockYearMonth) && <span className="text-xs text-amber-700 font-medium">Locked</span>}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Review cadence"
        className="mt-4"
        infoHint="Auto-built from your data: e.g. daily flags stale market data and debt stress; weekly flags uncategorized spend; monthly nudges snapshot + budget categories. No manual refresh button needed."
      >
        <p className="text-sm text-slate-600 mb-4">Structured checklists for daily, weekly, monthly, quarterly, and annual reviews.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Daily</h4>
            <ul className="space-y-1.5 text-sm">
              {dailyItems.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 ${item.severity === 'critical' ? 'text-red-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span className="shrink-0">•</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Weekly</h4>
            <ul className="space-y-1.5 text-sm">
              {weeklyItems.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 ${item.severity === 'critical' ? 'text-red-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span className="shrink-0">•</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Monthly</h4>
            <ul className="space-y-1.5 text-sm">
              {monthlyItems.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 ${item.severity === 'critical' ? 'text-red-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span className="shrink-0">•</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Quarterly</h4>
            <ul className="space-y-1.5 text-sm">
              {quarterlyItems.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 ${item.severity === 'critical' ? 'text-red-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span className="shrink-0">•</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Annual</h4>
            <ul className="space-y-1.5 text-sm">
              {annualItems.map((item) => (
                <li key={item.id} className={`flex items-start gap-2 ${item.severity === 'critical' ? 'text-red-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>
                  <span className="shrink-0">•</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <div className="flex flex-wrap gap-2 mt-6">
        {setActivePage && (
          <>
            <button type="button" className="btn-primary" onClick={() => setActivePage('Investments')}>
              Record trade
            </button>
            <button type="button" className="btn-outline" onClick={() => setActivePage('Liquidation Planner')}>
              Liquidation planner
            </button>
            <button type="button" className="btn-outline" onClick={() => setActivePage('Financial Journal')}>
              Journal
            </button>
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default RiskTradingHub;
