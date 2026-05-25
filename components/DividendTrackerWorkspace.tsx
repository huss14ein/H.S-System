import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_AXIS_COLOR,
  CHART_COLORS,
  CHART_GRID_COLOR,
  CHART_GRID_STROKE,
  CHART_MARGIN,
  formatAxisNumber,
} from './charts/chartTheme';
import ChartContainer from './charts/ChartContainer';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from './InfoHint';
import { ResolvedSymbolLabel } from './SymbolWithCompanyName';
import type { SymbolNamesMap } from './SymbolWithCompanyName';
import DividendSmsImportPanel, { DIVIDEND_SMS_IMPORT_SECTION_ID } from './DividendSmsImportPanel';
import type {
  DividendHoldingPlanRow,
  DividendQuarterlyTotals,
  DividendTrackerCoverage,
  DividendTrackerSummary,
} from '../services/dividendTrackerModel';
import type { UpcomingDividendPayout } from '../services/dividendExpectedSchedule';
import { cadenceLabel } from '../services/dividendExpectedSchedule';
import { saveExpectedAnnualOverride } from '../services/dividendExpectedOverrides';
import DividendLedgerPanel from './DividendLedgerPanel';
import type { Holding } from '../types';
import { expectedSourceLabel } from '../services/dividendTrackerModel';
import type { DividendLedgerEarner } from '../services/dividendLedgerRankings';
import type { DividendChartMonthRow } from '../services/dividendTrackerModel';
import type { InvestmentTransaction, Page } from '../types';
import { validateDividendPlanOverride } from '../services/dividendLedgerGuards';
import { useToast } from '../context/ToastContext';
import { openRecordDividendTrade } from '../services/dividendRecordTradeNavigation';
import { DataContext } from '../context/DataContext';
import { buildHoldingSymbolOptions } from '../services/holdingSymbolOptions';
import { getPersonalInvestments } from '../utils/wealthScope';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { BanknotesIcon } from './icons/BanknotesIcon';
import { TrophyIcon } from './icons/TrophyIcon';

type WorkspaceTab = 'overview' | 'plan' | 'import';

const TAB_LABELS: { id: WorkspaceTab; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'Received cash vs your annual plan at a glance' },
  { id: 'plan', label: 'Holdings plan', hint: 'Set expected dividends and track pace per symbol' },
  { id: 'import', label: 'Import & sync', hint: 'SMS import, Finnhub history, Record Trade' },
];

function paceTone(pct: number | null): string {
  if (pct == null) return 'bg-slate-100 text-slate-600';
  if (pct >= 95) return 'bg-emerald-100 text-emerald-800';
  if (pct >= 70) return 'bg-amber-100 text-amber-900';
  return 'bg-rose-100 text-rose-800';
}

const DividendTrackerWorkspace: React.FC<{
  summary: DividendTrackerSummary;
  holdingRows: DividendHoldingPlanRow[];
  topReceived: DividendLedgerEarner[];
  topExpected: Array<{ symbol: string; name: string; expectedSar: number }>;
  monthlyChart: DividendChartMonthRow[];
  platformStackKeys: { key: string; label: string }[];
  monthlyChartHasActivity: boolean;
  recentDividendTransactions: InvestmentTransaction[];
  dividendLedgerTransactions: InvestmentTransaction[];
  coverage: DividendTrackerCoverage;
  quarterlyTotals: DividendQuarterlyTotals;
  upcomingPayouts: UpcomingDividendPayout[];
  formatTxAmountSar: (t: InvestmentTransaction) => string;
  companyNames: SymbolNamesMap;
  syncBusy: boolean;
  onFinnhubSync: () => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  onPlanOverridesChanged: () => void;
  initialTab?: WorkspaceTab;
}> = ({
  summary,
  holdingRows,
  topReceived,
  topExpected,
  monthlyChart,
  platformStackKeys,
  monthlyChartHasActivity,
  recentDividendTransactions,
  dividendLedgerTransactions,
  coverage,
  quarterlyTotals,
  upcomingPayouts,
  formatTxAmountSar,
  companyNames,
  syncBusy,
  onFinnhubSync,
  setActivePage,
  triggerPageAction,
  onPlanOverridesChanged,
  initialTab = 'overview',
}) => {
  const { data, updateHolding } = useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const { showToast } = useToast();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [chartMode, setChartMode] = useState<'received' | 'plan'>('received');
  const [planFilter, setPlanFilter] = useState<'all' | 'with-expected' | 'behind'>('all');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editAnnual, setEditAnnual] = useState('');
  const [editYield, setEditYield] = useState('');
  const [editCadence, setEditCadence] = useState<Holding['dividendPayoutCadence']>('none');
  const [editPayoutMonths, setEditPayoutMonths] = useState('');

  const holdingOptions = useMemo(
    () => buildHoldingSymbolOptions(getPersonalInvestments(data)),
    [data],
  );

  const optionByRowKey = useMemo(() => {
    const m = new Map<string, (typeof holdingOptions)[0]>();
    for (const o of holdingOptions) {
      m.set(`${o.portfolioId}:${o.symbol.toUpperCase()}`, o);
    }
    return m;
  }, [holdingOptions]);

  const filteredRows = useMemo(() => {
    if (planFilter === 'with-expected') return holdingRows.filter((r) => r.expectedAnnualSar > 0.01);
    if (planFilter === 'behind')
      return holdingRows.filter((r) => r.expectedAnnualSar > 0.01 && (r.pacePct == null || r.pacePct < 85));
    return holdingRows;
  }, [holdingRows, planFilter]);

  const openRecordForRow = useCallback(
    (row: DividendHoldingPlanRow) => {
      const opt = optionByRowKey.get(`${row.portfolioId}:${row.symbol}`);
      if (!opt) return;
      openRecordDividendTrade({
        symbol: row.symbol,
        name: row.name,
        portfolioId: row.portfolioId,
        accountId: opt.accountId,
        tradeCurrency: row.bookCurrency,
        setActivePage,
        triggerPageAction,
      });
    },
    [optionByRowKey, setActivePage, triggerPageAction],
  );

  const findHoldingForRow = useCallback(
    (row: DividendHoldingPlanRow) => {
      const portfolio = getPersonalInvestments(data).find((p) => p.id === row.portfolioId);
      return portfolio?.holdings?.find(
        (h) => String(h.id) === row.holdingId || String(h.symbol).toUpperCase() === row.symbol,
      );
    },
    [data],
  );

  const startEditPlan = (row: DividendHoldingPlanRow) => {
    const key = `${row.portfolioId}:${row.symbol}`;
    setEditingKey(key);
    setEditAnnual(row.expectedAnnualSar > 0 ? String(Math.round(row.expectedAnnualSar)) : '');
    setEditYield(row.holdingYieldPct != null ? String(row.holdingYieldPct) : '');
    setEditCadence(row.dividendPayoutCadence ?? 'none');
    setEditPayoutMonths(row.typicalPayoutMonths?.length ? row.typicalPayoutMonths.join(',') : '');
  };

  const savePlanEdits = async (row: DividendHoldingPlanRow) => {
    const planCheck = validateDividendPlanOverride({
      annualSar: editAnnual.trim() === '' ? null : editAnnual,
      yieldPct: editYield.trim() === '' ? null : editYield,
    });
    if (!planCheck.valid) {
      showToast(planCheck.errors[0] ?? 'Invalid plan values.', 'warning');
      return;
    }

    const holding = findHoldingForRow(row);
    if (!holding) {
      showToast('Holding not found for this row.', 'warning');
      return;
    }

    const parsedMonths = editPayoutMonths
      .split(/[,;\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((m) => m >= 1 && m <= 12);
    const uniqueMonths = [...new Set(parsedMonths)].sort((a, b) => a - b);

    const next: Holding = { ...holding };
    if (editAnnual.trim() === '') {
      next.expectedAnnualDividendSar = undefined;
      saveExpectedAnnualOverride(row.portfolioId, row.symbol, null);
    } else if (planCheck.annualSar != null && planCheck.annualSar > 0) {
      next.expectedAnnualDividendSar = planCheck.annualSar;
      saveExpectedAnnualOverride(row.portfolioId, row.symbol, null);
    }
    if (editYield.trim() === '') {
      next.dividendYield = undefined;
    } else if (planCheck.yieldPct != null) {
      next.dividendYield = planCheck.yieldPct;
    }
    next.dividendPayoutCadence = editCadence === 'none' ? undefined : editCadence;
    next.typicalPayoutMonths = uniqueMonths.length > 0 ? uniqueMonths : undefined;

    await updateHolding(next);

    setEditingKey(null);
    onPlanOverridesChanged();
    showToast('Dividend plan saved to this holding.', 'success');
  };

  const clearPlanOverride = async (row: DividendHoldingPlanRow) => {
    const holding = findHoldingForRow(row);
    saveExpectedAnnualOverride(row.portfolioId, row.symbol, null);
    if (holding) {
      await updateHolding({
        ...holding,
        expectedAnnualDividendSar: undefined,
        dividendPayoutCadence: undefined,
        typicalPayoutMonths: undefined,
      });
    }
    onPlanOverridesChanged();
    showToast(`Cleared plan for ${row.symbol}.`, 'info');
  };

  const applyMarketHints = async () => {
    let updated = 0;
    for (const row of holdingRows) {
      if (row.expectedSource !== 'none' || row.marketYieldPct == null || !(row.marketYieldPct > 0)) continue;
      const portfolio = getPersonalInvestments(data).find((p) => p.id === row.portfolioId);
      const holding = portfolio?.holdings?.find(
        (h) => String(h.id) === row.holdingId || String(h.symbol).toUpperCase() === row.symbol,
      );
      if (!holding) continue;
      await updateHolding({ ...holding, dividendYield: row.marketYieldPct });
      updated += 1;
    }
    onPlanOverridesChanged();
    showToast(updated > 0 ? `Applied market yield hint to ${updated} holding(s).` : 'No holdings needed market hints.', 'info');
  };

  const exportRecentCsv = () => {
    if (recentDividendTransactions.length === 0) return;
    const csv = [
      ['Date', 'Symbol', 'Amount_SAR_equiv'].join(','),
      ...recentDividendTransactions.map((t) => [t.date, t.symbol ?? '', formatTxAmountSar(t)].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dividends-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const chartData = useMemo(
    () =>
      monthlyChart.map((row) => ({
        ...row,
        planLine: row.expectedSar,
      })),
    [monthlyChart],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist">
          {TAB_LABELS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.hint}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t.id ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => openRecordDividendTrade({ setActivePage, triggerPageAction })}
          >
            Record dividend (Investments)
          </button>
          <button
            type="button"
            disabled={syncBusy}
            onClick={onFinnhubSync}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${syncBusy ? 'animate-spin' : ''}`} />
            {syncBusy ? 'Syncing…' : 'Sync history'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Received (YTD)"
          value={formatCurrencyString(summary.receivedYtdSar)}
          sub="Cash booked in your ledger"
          icon={<TrophyIcon className="h-5 w-5 text-success" />}
          hint="Sum of dividend transactions this calendar year, SAR equivalent."
          accent="success"
        />
        <KpiCard
          title="Received (12 mo)"
          value={formatCurrencyString(summary.received12mSar)}
          sub={`${summary.holdingsWithReceived12m} holding(s) paid`}
          icon={<BanknotesIcon className="h-5 w-5 text-primary" />}
          hint="Trailing twelve months of dividend cash on personal platforms."
          accent="primary"
        />
        <KpiCard
          title="Expected annual (plan)"
          value={formatCurrencyString(summary.expectedAnnualSar)}
          sub={`${summary.holdingsWithExpected} holding(s) with a plan`}
          icon={<BanknotesIcon className="h-5 w-5 text-violet-600" />}
          hint="Your plan: manual override, holding yield %, or market hint (labeled per row). Not the same as received."
          accent="violet"
        />
        <KpiCard
          title="YTD vs plan pace"
          value={summary.pacePct != null ? `${summary.pacePct.toFixed(0)}%` : '—'}
          sub={
            summary.expectedYtdPaceSar > 0
              ? `Plan YTD ${formatCurrencyString(summary.expectedYtdPaceSar)}`
              : 'Set expected amounts in Holdings plan'
          }
          icon={<TrophyIcon className="h-5 w-5 text-amber-600" />}
          hint="Received YTD divided by prorated annual plan (Jan 1 → today). Above 100% means ahead of schedule."
          accent="amber"
          badgeClass={paceTone(summary.pacePct)}
        />
      </div>

      {(coverage.withoutPlan > 0 || coverage.withoutReceivedYtd > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <strong>Setup:</strong>{' '}
            {coverage.withoutPlan > 0 && (
              <span>
                {coverage.withoutPlan} holding{coverage.withoutPlan !== 1 ? 's' : ''} without an expected plan.{' '}
              </span>
            )}
            {coverage.withoutReceivedYtd > 0 && (
              <span>
                {coverage.withoutReceivedYtd} with no dividends recorded YTD.{' '}
              </span>
            )}
            <span className="text-amber-800">Finnhub auto-sync is US equities only — use Record Trade or SMS for Tadawul.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setTab('plan')}>
              Open holdings plan
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => void applyMarketHints()}>
              Apply market yield hints
            </button>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <>
          <div className="section-card">
            <h3 className="section-title mb-2">Quarterly progress (YTD)</h3>
            <p className="text-sm text-slate-600 mb-4">
              Received cash by calendar quarter vs an even split of your <strong>annual plan</strong> (estimate).
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((label, qi) => {
                const received = quarterlyTotals.receivedByQuarter[qi];
                const expected = quarterlyTotals.expectedPerQuarter;
                const pct = expected > 0 ? Math.min(100, (received / expected) * 100) : 0;
                return (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <p className="text-xs font-bold text-slate-600">{label}</p>
                    <p className="text-sm font-semibold tabular-nums mt-1">{formatCurrencyString(received)}</p>
                    <p className="text-[11px] text-slate-500">Plan ~{formatCurrencyString(expected)}</p>
                    <div className="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {upcomingPayouts.length > 0 && (
            <div className="section-card">
              <h3 className="section-title mb-2">Upcoming expected payouts (estimate)</h3>
              <p className="text-sm text-slate-600 mb-3">
                Based on your annual plan and typical quarterly dates — not broker confirmations.
              </p>
              <ul className="space-y-2">
                {upcomingPayouts.map((p) => (
                  <li key={`${p.symbol}-${p.payDate}`} className="list-row text-sm">
                    <ResolvedSymbolLabel symbol={p.symbol} storedName={p.name} names={companyNames} layout="stacked" symbolClassName="font-bold" />
                    <span className="text-xs text-slate-500">{p.portfolioName}</span>
                    <span className="ml-auto text-right tabular-nums">
                      <span className="font-semibold text-violet-900">{formatCurrencyString(p.amountSar)}</span>
                      <span className="block text-[11px] text-slate-500">{new Date(p.payDate).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="section-card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="section-title mb-1">Cash flow vs plan</h3>
                <p className="text-sm text-slate-600">
                  Bars = <strong>received</strong> cash by platform. Line = smooth monthly slice of your{' '}
                  <strong>annual plan</strong> (even spread for visualization).
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                <button
                  type="button"
                  className={`px-3 py-1 text-xs font-semibold rounded-md ${chartMode === 'received' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
                  onClick={() => setChartMode('received')}
                >
                  By platform
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 text-xs font-semibold rounded-md ${chartMode === 'plan' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
                  onClick={() => setChartMode('plan')}
                >
                  Total + plan line
                </button>
              </div>
            </div>
            {!monthlyChartHasActivity && summary.expectedAnnualSar <= 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                No dividends in the last 12 months. Record cash via <strong>Investments → Record Trade → Dividend</strong>, import SMS, or run Finnhub sync.
              </p>
            )}
            <div className="h-[360px]">
              <ChartContainer height="100%" isEmpty={false}>
                <ResponsiveContainer width="100%" height="100%">
                  {chartMode === 'plan' ? (
                    <ComposedChart data={chartData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                      <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} width={48} />
                      <Tooltip formatter={(val: number) => formatCurrencyString(val, { digits: 0 })} />
                      <Legend />
                      <Bar dataKey="receivedSar" name="Received (SAR)" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="planLine" name="Plan (monthly slice)" stroke={CHART_COLORS.categorical[4]} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  ) : (
                    <BarChart data={chartData} margin={CHART_MARGIN}>
                      <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                      <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} width={48} />
                      <Tooltip formatter={(val: number) => formatCurrencyString(val, { digits: 0 })} />
                      <Legend iconType="circle" iconSize={8} />
                      {platformStackKeys.length > 0 ? (
                        platformStackKeys.map((pk, i) => (
                          <Bar
                            key={pk.key}
                            dataKey={pk.key}
                            stackId="div"
                            fill={CHART_COLORS.categorical[i % CHART_COLORS.categorical.length]}
                            name={pk.label}
                            radius={i === platformStackKeys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                          />
                        ))
                      ) : (
                        <Bar dataKey="receivedSar" fill={CHART_COLORS.secondary} name="Received" radius={[6, 6, 0, 0]} />
                      )}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RankList
              title="Top received (12 mo)"
              subtitle="From your ledger only"
              empty="Record dividends on Investments to populate rankings."
              items={topReceived.map((p, i) => ({
                rank: i + 1,
                symbol: p.symbol,
                name: p.name,
                primary: formatCurrencyString(p.receivedSar),
                meta: `${p.paymentCount} payment${p.paymentCount !== 1 ? 's' : ''}`,
              }))}
              companyNames={companyNames}
            />
            <RankList
              title="Largest expected (plan)"
              subtitle="Annual plan per holding — not cash received"
              empty="Set yield % or expected SAR in Holdings plan tab."
              items={topExpected.map((p, i) => ({
                rank: i + 1,
                symbol: p.symbol,
                name: p.name,
                primary: formatCurrencyString(p.expectedSar),
                meta: 'annual plan',
              }))}
              companyNames={companyNames}
              tone="violet"
            />
          </div>

          <RecentPaymentsTable
            rows={recentDividendTransactions}
            formatTxAmountSar={formatTxAmountSar}
            companyNames={companyNames}
            onRecord={() => openRecordDividendTrade({ setActivePage, triggerPageAction })}
            onExport={exportRecentCsv}
          />
        </>
      )}

      {tab === 'plan' && (
        <div className="section-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="section-title mb-1">Holdings dividend plan</h3>
              <p className="text-sm text-slate-600">
                Edit <strong>expected annual (SAR)</strong> or <strong>yield %</strong> on the holding. Market hints fill gaps only when you have not set a plan.
              </p>
            </div>
            <select className="select-base text-sm w-auto" value={planFilter} onChange={(e) => setPlanFilter(e.target.value as typeof planFilter)}>
              <option value="all">All holdings</option>
              <option value="with-expected">With a plan</option>
              <option value="behind">Behind pace (&lt;85%)</option>
            </select>
          </div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-700">Symbol</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Received YTD</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">12 mo</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Expected / yr</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Q est.</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Cadence</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Source</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Pace</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const key = `${row.portfolioId}:${row.symbol}`;
                  const isEditing = editingKey === key;
                  return (
                    <tr key={key} className="hover:bg-slate-50/80">
                      <td className="px-3 py-3">
                        <ResolvedSymbolLabel symbol={row.symbol} storedName={row.name} names={companyNames} layout="stacked" symbolClassName="font-bold" />
                        <span className="text-xs text-slate-500 block">{row.portfolioName}</span>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{formatCurrencyString(row.receivedYtdSar)}</td>
                      <td className="px-3 py-3 tabular-nums">{formatCurrencyString(row.received12mSar)}</td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <input
                              className="input-base text-xs w-28"
                              placeholder="Annual SAR"
                              value={editAnnual}
                              onChange={(e) => setEditAnnual(e.target.value)}
                            />
                            <input
                              className="input-base text-xs w-20"
                              placeholder="Yield %"
                              value={editYield}
                              onChange={(e) => setEditYield(e.target.value)}
                            />
                            <select
                              className="select-base text-xs"
                              value={editCadence ?? 'none'}
                              onChange={(e) => setEditCadence(e.target.value as Holding['dividendPayoutCadence'])}
                            >
                              <option value="none">Cadence (auto)</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="annual">Annual</option>
                              <option value="reinvest">Reinvest</option>
                            </select>
                            <input
                              className="input-base text-xs w-full"
                              placeholder="Payout months (1-12, comma)"
                              value={editPayoutMonths}
                              onChange={(e) => setEditPayoutMonths(e.target.value)}
                            />
                          </div>
                        ) : (
                          <span className="font-semibold tabular-nums">
                            {row.expectedAnnualSar > 0 ? formatCurrencyString(row.expectedAnnualSar) : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs text-slate-600">
                        {row.quarterlyExpectedSar > 0 ? formatCurrencyString(row.quarterlyExpectedSar) : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {cadenceLabel(row.cadence)}
                        {row.dividendDistribution && (
                          <span className="block text-[10px] text-slate-500">{row.dividendDistribution}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                          {expectedSourceLabel(row.expectedSource)}
                          {row.hasManualOverride && ' · manual'}
                        </span>
                        {row.marketDpsAnnual != null && row.expectedSource.startsWith('market') && (
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            Mkt DPS {row.marketDpsAnnual.toFixed(2)} {row.marketDpsCurrency ?? 'USD'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {row.expectedAnnualSar > 0 ? (
                          <div>
                            <div className="h-2 w-24 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, row.pacePct ?? 0)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-semibold mt-1 inline-block px-1.5 rounded ${paceTone(row.pacePct)}`}>
                              {row.pacePct != null ? `${row.pacePct.toFixed(0)}%` : '—'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button type="button" className="text-xs font-semibold text-primary mr-2" onClick={() => void savePlanEdits(row)}>
                              Save
                            </button>
                            <button type="button" className="text-xs text-slate-500" onClick={() => setEditingKey(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="text-xs font-semibold text-primary mr-2" onClick={() => startEditPlan(row)}>
                              Plan
                            </button>
                            <button type="button" className="text-xs font-semibold text-emerald-700 mr-2" onClick={() => openRecordForRow(row)}>
                              Record
                            </button>
                            {(row.hasManualOverride || row.expectedAnnualSar > 0) && (
                              <button type="button" className="text-xs text-slate-500" onClick={() => void clearPlanOverride(row)}>
                                Clear plan
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && (
            <p className="text-center text-slate-500 py-8">No holdings match this filter.</p>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-6">
          <div className="section-card border border-slate-200 bg-slate-50/50">
            <h3 className="section-title mb-2">Record received cash</h3>
            <p className="text-sm text-slate-600 mb-4">
              Use the same <strong>Record Trade → Dividend</strong> flow as the Investments page. That updates platform cash, YTD income, charts, and rankings here.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                openRecordDividendTrade({ setActivePage, triggerPageAction })
              }
            >
              Open Record Trade (dividend)
            </button>
          </div>
          <div id={DIVIDEND_SMS_IMPORT_SECTION_ID}>
            <DividendSmsImportPanel />
          </div>
          <div className="section-card border border-slate-200">
            <h3 className="section-title mb-2">Trading statement upload</h3>
            <p className="text-sm text-slate-600 mb-3">
              PDF/CSV statements can include dividends — duplicates are blocked the same way as Record Trade.
            </p>
            <button type="button" className="btn-secondary text-sm" onClick={() => setActivePage?.('Statement Upload')}>
              Open Statement Upload
            </button>
          </div>
          <DividendLedgerPanel
            transactions={dividendLedgerTransactions}
            companyNames={companyNames}
            formatTxAmountSar={formatTxAmountSar}
          />
          <div className="section-card border border-amber-100 bg-amber-50/40">
            <h3 className="section-title mb-2">Tadawul &amp; local symbols</h3>
            <p className="text-sm text-slate-700">
              Saudi tickers (e.g. <strong>1120</strong>, <strong>2222</strong>) are not covered by Finnhub dividend history.
              Record payouts via <strong>Record Trade → Dividend</strong>, SMS import, or trading statements. Set expected annual SAR and payout months on the Holdings plan tab.
            </p>
          </div>
          <div className="section-card">
            <h3 className="section-title mb-2">Finnhub historical sync</h3>
            <p className="text-sm text-slate-600 mb-4">
              Pulls reported per-share dividends, multiplies by your quantity, and books rows on each platform ledger. Requires{' '}
              <code className="text-xs bg-slate-100 px-1 rounded">VITE_FINNHUB_API_KEY</code>.
            </p>
            <button type="button" disabled={syncBusy} onClick={onFinnhubSync} className="btn-secondary inline-flex items-center gap-2">
              <ArrowPathIcon className={`h-4 w-4 ${syncBusy ? 'animate-spin' : ''}`} />
              {syncBusy ? 'Syncing…' : 'Run Finnhub sync now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function KpiCard(props: {
  title: string;
  value: string;
  sub: string;
  hint: string;
  icon: React.ReactNode;
  accent: 'success' | 'primary' | 'violet' | 'amber';
  badgeClass?: string;
}) {
  const ring =
    props.accent === 'success'
      ? 'border-emerald-100'
      : props.accent === 'violet'
        ? 'border-violet-100'
        : props.accent === 'amber'
          ? 'border-amber-100'
          : 'border-slate-200';
  return (
    <div className={`section-card border ${ring}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
          {props.title}
          <InfoHint text={props.hint} />
        </p>
        <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">{props.icon}</div>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${props.badgeClass ? props.badgeClass + ' inline-block px-2 py-0.5 rounded-lg' : 'text-dark'}`}>
        {props.value}
      </p>
      <p className="text-sm text-slate-600 mt-1">{props.sub}</p>
    </div>
  );
}

function RankList(props: {
  title: string;
  subtitle: string;
  empty: string;
  items: Array<{ rank: number; symbol?: string; name: string; primary: string; meta: string }>;
  companyNames: SymbolNamesMap;
  tone?: 'emerald' | 'violet';
}) {
  const chip = props.tone === 'violet' ? 'bg-violet-50 text-violet-900 border-violet-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return (
    <div className="section-card">
      <h3 className="section-title">{props.title}</h3>
      <p className="text-sm text-slate-500 mb-4">{props.subtitle}</p>
      {props.items.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">{props.empty}</p>
      ) : (
        <div className="space-y-2">
          {props.items.map((item) => (
            <div key={`${item.symbol}-${item.rank}`} className="list-row">
              <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold">{item.rank}</span>
              {item.symbol ? (
                <ResolvedSymbolLabel symbol={item.symbol} storedName={item.name} names={props.companyNames} layout="stacked" symbolClassName="font-bold" />
              ) : (
                <span className="font-bold">{item.name}</span>
              )}
              <div className="ml-auto text-right">
                <span className={`font-bold text-sm border px-2 py-1 rounded-lg tabular-nums ${chip}`}>{item.primary}</span>
                <span className="text-[11px] text-slate-500 block">{item.meta}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentPaymentsTable(props: {
  rows: InvestmentTransaction[];
  formatTxAmountSar: (t: InvestmentTransaction) => string;
  companyNames: SymbolNamesMap;
  onRecord: () => void;
  onExport: () => void;
}) {
  return (
    <div className="section-card">
      <h3 className="section-title">Recent payments (ledger)</h3>
      <div className="overflow-x-auto mt-3">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.rows.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">{new Date(t.date).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <ResolvedSymbolLabel symbol={t.symbol || ''} names={props.companyNames} layout="inline" />
                </td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-800">{props.formatTxAmountSar(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {props.rows.length > 0 && (
          <button type="button" className="btn-secondary text-sm" onClick={props.onExport}>
            Export CSV
          </button>
        )}
        <button type="button" className="btn-primary text-sm" onClick={props.onRecord}>
          Record dividend on Investments
        </button>
      </div>
    </div>
  );
}

export default DividendTrackerWorkspace;
