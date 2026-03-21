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
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';
import { countsAsIncomeForCashflowKpi, countsAsExpenseForCashflowKpi } from '../services/transactionFilters';

const RiskTradingHub: React.FC<{ setActivePage?: (p: Page) => void; triggerPageAction?: (page: Page, action: string) => void }> = ({ setActivePage, triggerPageAction }) => {
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
    const uncategorized = txs.filter((t) => countsAsExpenseForCashflowKpi(t) && !t.budgetCategory).length;
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
    const tv = getAllInvestmentsValueInSAR(inv, exchangeRate);
    const r = approximatePortfolioMWRR(flows, tv, new Date().toISOString().slice(0, 10));
    return r;
  }, [data, exchangeRate]);

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
      title="Safety & rules"
      description="Your safety checks and rules before buying or selling. See how much you have in reserve, your portfolio return, and when to review things."
    >
      <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
        <p className="text-sm text-slate-700">
          <strong className="text-slate-900">What is this?</strong> A quick view of your emergency cushion, how your portfolio is doing, and the rules you set to avoid impulsive trades. Not financial advice.
        </p>
      </div>

      {(setActivePage || triggerPageAction) && (
        <p className="text-sm text-slate-600 mb-4">
          <button type="button" className="text-primary-600 font-medium hover:text-primary-700 underline" onClick={() => setActivePage?.('Engines & Tools')}>
            Money Tools
          </button>{' '}
          — sell priority, notes & ideas, and behind-the-numbers.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Months of expenses covered" infoHint="How many months your checking + savings could cover essential spending. A common target is 3–6 months." collapsible collapsibleSummary="Runway" defaultExpanded
        >
          <p className="text-2xl font-bold text-slate-900">{ef.monthsCovered.toFixed(1)} mo</p>
          <p className="text-sm text-slate-600">Coverage vs {ef.targetMonths} mo target</p>
        </SectionCard>
        <SectionCard title="Buy readiness" infoHint="A simple score from 0–100: higher = conditions are better for buying (e.g. enough runway)." collapsible collapsibleSummary="0–100 score"
        >
          <p className="text-sm">
            Score: <strong className="text-primary">{buyS}</strong> / 100 · Sell sample:{' '}
            <strong className="text-rose-700">{sellS.score}</strong> ({sellS.reasons.join(', ')})
          </p>
        </SectionCard>
        <SectionCard title="Your safety rules" infoHint="Rules you set to avoid impulsive trades. Edit in Settings." collapsible collapsibleSummary="Trading guardrails"
        >
          <ul className="text-sm text-slate-700 space-y-1">
            <li>Min months of savings before buying: {policy.minRunwayMonthsToAllowBuys} mo</li>
            <li>Max % in any single holding: {policy.maxPositionWeightPct}%</li>
            <li>Block buys if last month was negative: {policy.blockBuysIfMonthlyNetNegative ? 'Yes' : 'No'}</li>
            <li>Large sell confirmation over: {formatCurrencyString(policy.requireAckLargeSellNotional, { digits: 0 })}</li>
          </ul>
          {setActivePage && (
            <button type="button" className="btn-outline text-sm mt-3" onClick={() => setActivePage('Settings')}>
              Edit in Settings
            </button>
          )}
        </SectionCard>
        <SectionCard title="Portfolio return (simplified)" infoHint="How your investments performed over time, considering deposits and withdrawals. Not audited." collapsible collapsibleSummary="Return over time"
        >
          <p className="text-2xl font-bold">{mwrr != null ? `${mwrr.toFixed(2)}%` : '—'}</p>
          <p className="text-xs text-slate-500">Based on your deposits, withdrawals, and current value.</p>
        </SectionCard>
      </div>
      <SectionCard title="Why did net worth change?" className="mt-4" collapsible collapsibleSummary="Contributions vs market"
        infoHint="Breaks down your net worth change into: money you added/withdrew vs market moves and other changes."
      >
        {attr ? (
          <>
            <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside">
              {attr.bullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-3">
              Cashflow = money you added or withdrew. Residual = market moves, debt, and other changes.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Need <strong>two</strong> net worth snapshots. Create one on the Dashboard on two different days, then return here.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Net worth snapshots" className="mt-4" collapsible collapsibleSummary="Saved snapshots"
        infoHint="Save snapshots of your net worth over time to compare and see how it changed."
      >
        <p className="text-sm text-slate-600 mb-3">Save a snapshot of your net worth today, compare two dates, or view a past date.</p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <button
            type="button"
            className="btn-primary text-sm"
            title="Save today's net worth"
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
            Save snapshot now
          </button>
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={fillLastTwoSnapshots}
            disabled={snapshotDates.length < 2}
            title={snapshotDates.length < 2 ? 'Need at least two snapshots' : 'Use the two most recent dates'}
          >
            Use last 2 dates
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
                <label className="block text-xs font-semibold text-slate-600 mb-1">View net worth as of</label>
                <input type="date" className="input-base w-full max-w-[180px]" value={restoreDate} onChange={(e) => setRestoreDate(e.target.value)} />
              </div>
              {restoredSnapshot && (
                <p className="text-sm text-slate-800">NW as of {restoredSnapshot.at.slice(0, 10)}: <strong>{formatCurrencyString(restoredSnapshot.netWorth, { digits: 0 })}</strong></p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
              <label className="block text-xs font-semibold text-slate-600">Lock month (no further edits)</label>
              <input type="month" className="input-base w-36" value={lockYearMonth} onChange={(e) => setLockYearMonth(e.target.value)} />
              <button type="button" className="btn-outline text-sm" onClick={() => lockYearMonth && lockMonthEnd(lockYearMonth)}>Lock</button>
              {lockYearMonth && isMonthLocked(lockYearMonth) && <span className="text-xs text-amber-700 font-medium">Locked</span>}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Review cadence" className="mt-4" collapsible collapsibleSummary="When to review"
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
              Record a trade
            </button>
            <button type="button" className="btn-outline" onClick={() => triggerPageAction ? triggerPageAction('Engines & Tools', 'openLiquidation') : setActivePage?.('Engines & Tools')}>
              Sell priority
            </button>
            <button type="button" className="btn-outline" onClick={() => triggerPageAction ? triggerPageAction('Engines & Tools', 'openJournal') : setActivePage?.('Engines & Tools')}>
              Notes & ideas
            </button>
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default RiskTradingHub;
