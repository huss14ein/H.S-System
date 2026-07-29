import React from 'react';
import type { SalaryInvestmentKpis } from '../services/salaryInvestmentKpis';
import EmptyState from './EmptyState';
import { BanknotesIcon } from './icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { PiggyBankIcon } from './icons/PiggyBankIcon';
import { BuildingLibraryIcon } from './icons/BuildingLibraryIcon';

type Props = {
  model: SalaryInvestmentKpis | null | undefined;
  /** True while extended canonical metrics (incl. salary KPIs) are still computing. */
  loading?: boolean;
  title?: string;
  subtitle?: string;
  formatCurrencyString: (value: number, options?: { digits?: number; inCurrency?: 'SAR' | 'USD'; showSecondary?: boolean }) => string;
  compact?: boolean;
  onOpenSettings?: () => void;
  onOpenInvestments?: () => void;
  onOpenTransactions?: () => void;
};

function pct(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
}

export default function SalaryInvestmentSummaryCard({
  model,
  loading = false,
  title = 'Salary to investment',
  subtitle = 'Track how much salary turned into funded broker cash and deployed positions this financial month.',
  formatCurrencyString,
  compact = false,
  onOpenSettings,
  onOpenInvestments,
  onOpenTransactions,
}: Props) {
  if (loading || model == null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-busy="true" aria-live="polite">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Computing salary-invest metrics…</p>
      </div>
    );
  }

  if (!model.hasSalarySignal) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <EmptyState
          icon={<BanknotesIcon />}
          title="No salary signal yet"
          description="Tag salary transactions clearly or pick a salary source account so monthly invest-rate KPIs can attribute funding correctly."
          action={onOpenTransactions ? { label: 'Open Transactions', onClick: onOpenTransactions } : undefined}
          secondaryAction={onOpenSettings ? { label: 'Open Settings', onClick: onOpenSettings } : undefined}
          className="py-8"
        />
      </div>
    );
  }

  const breakdownRows = compact ? model.salaryFundingByPlatform.slice(0, 3) : model.salaryFundingByPlatform.slice(0, 5);
  const assetRows = compact ? model.salaryFundingByAssetClass.slice(0, 3) : model.salaryFundingByAssetClass.slice(0, 5);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenInvestments && (
            <button type="button" onClick={onOpenInvestments} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Open Investments
            </button>
          )}
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Targets
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<BanknotesIcon className="h-4 w-4" />}
          label="Salary this month"
          value={formatCurrencyString(model.salaryIncomeSarMonth, { digits: 0 })}
          hint={`Detection confidence: ${model.salaryDetectionConfidence}`}
        />
        <MetricCard
          icon={<ArrowTrendingUpIcon className="h-4 w-4" />}
          label="Invested from salary"
          value={formatCurrencyString(model.investedFromSalarySarMonth, { digits: 0 })}
          hint={`${pct(model.salaryInvestRatePct)} of salary`}
        />
        <MetricCard
          icon={<BuildingLibraryIcon className="h-4 w-4" />}
          label="Funded not deployed"
          value={formatCurrencyString(model.fundedNotDeployedSar, { digits: 0 })}
          hint={model.fundedNotDeployedSar > 0 ? 'Broker cash still waiting to be deployed' : 'No salary-funded cash idle'}
        />
        <MetricCard
          icon={<PiggyBankIcon className="h-4 w-4" />}
          label="Surplus after spending"
          value={formatCurrencyString(model.surplusAfterSpendingSar, { digits: 0 })}
          hint={model.hasTargetsConfigured ? `Gap vs target: ${formatCurrencyString(model.targetVsActualGapSar, { digits: 0 })}` : 'No target configured'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BreakdownPanel
          title="Funding by platform"
          rows={breakdownRows}
          emptyLabel="No salary-funded broker deposits this financial month."
          formatCurrencyString={formatCurrencyString}
        />
        <BreakdownPanel
          title="Deployment by asset class"
          rows={assetRows}
          emptyLabel="No buy deployment recorded this financial month."
          formatCurrencyString={formatCurrencyString}
        />
        {!compact && model.salaryFundingByGoal.length > 0 && (
          <BreakdownPanel
            title="Deployment by goal"
            rows={model.salaryFundingByGoal.slice(0, 5)}
            emptyLabel="No goal-linked buys this financial month."
            formatCurrencyString={formatCurrencyString}
          />
        )}
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">6-month trend</h4>
          <p className="text-[11px] text-slate-500">Financial months</p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {model.history.slice(-6).map((row) => (
            <div key={row.monthKey} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.monthKey}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatCurrencyString(row.investedFromSalarySar, { digits: 0 })}
              </p>
              <p className="text-[11px] text-slate-500">{pct(row.salaryInvestRatePct)} invested from salary</p>
            </div>
          ))}
        </div>
      </div>

      {(model.unlinkedBrokerFundingSar > 0 || model.nonSalaryFundingSar > 0) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-semibold">Attribution gaps</p>
          <p className="mt-1">
            Unlinked broker funding: {formatCurrencyString(model.unlinkedBrokerFundingSar, { digits: 0 })}. Non-salary funding:{' '}
            {formatCurrencyString(model.nonSalaryFundingSar, { digits: 0 })}.
          </p>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-lg font-extrabold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function BreakdownPanel({
  title,
  rows,
  emptyLabel,
  formatCurrencyString,
}: {
  title: string;
  rows: Array<{ key: string; label: string; sar: number; targetSar?: number }>;
  emptyLabel: string;
  formatCurrencyString: Props['formatCurrencyString'];
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{row.label}</p>
                {row.targetSar != null && row.targetSar > 0 && (
                  <p className="text-[11px] text-slate-500">Target {formatCurrencyString(row.targetSar, { digits: 0 })}</p>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-900">{formatCurrencyString(row.sar, { digits: 0 })}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
