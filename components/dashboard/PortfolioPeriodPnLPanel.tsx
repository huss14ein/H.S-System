import React, { useMemo } from 'react';
import type { Account, FinancialData } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { usePrivacyMask } from '../../context/PrivacyContext';
import InfoHint from '../InfoHint';
import CollapsibleSection from '../CollapsibleSection';
import {
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
} from '../../services/portfolioPeriodPnL';
import type { SimulatedPriceMap } from '../../services/investmentPlatformCardMetrics';
import type { InvestmentPortfolio } from '../../types';
import type { Page } from '../../types';
import { PortfolioPnLTrendCharts } from '../analytics/PortfolioPnLTrendCharts';

const PnLCell: React.FC<{ value: number; format: (n: number) => string; mask: (s: string) => string }> = ({
  value,
  format,
  mask,
}) => {
  const cls =
    Math.abs(value) < 0.5 ? 'text-slate-600' : value > 0 ? 'text-emerald-700' : 'text-rose-700';
  return (
    <span className={`font-bold tabular-nums ${cls}`}>
      {value >= 0 ? '+' : ''}
      {mask(format(value))}
    </span>
  );
};

export const PortfolioPeriodPnLPanel: React.FC<{
  data: FinancialData;
  portfolios: InvestmentPortfolio[];
  accounts: Account[];
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  monthStartDay: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  setActivePage?: (page: Page) => void;
}> = ({
  data,
  portfolios,
  accounts,
  sarPerUsd,
  simulatedPrices,
  monthStartDay,
  getAvailableCashForAccount,
  setActivePage,
}) => {
  const { t, dir, language } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();
  const { maskBalance } = usePrivacyMask();

  const summary = useMemo(
    () =>
      computePortfolioPeriodPnLSummary({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        monthStartDay,
        getAvailableCashForAccount,
      }),
    [data, portfolios, accounts, sarPerUsd, simulatedPrices, monthStartDay, getAvailableCashForAccount],
  );

  const dailySeries = useMemo(
    () =>
      computePortfolioPnLDailySeries({
        data,
        portfolios,
        accounts,
        sarPerUsd,
        simulatedPrices,
        monthStartDay,
        getAvailableCashForAccount,
        locale: language === 'ar' ? 'ar-SA' : 'en-US',
      }),
    [data, portfolios, accounts, sarPerUsd, simulatedPrices, monthStartDay, getAvailableCashForAccount, language],
  );

  if (summary.rows.length === 0) {
    return (
      <div dir={dir} className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-slate-600">
        {t('portfolioPeriodPnLEmpty')}
      </div>
    );
  }

  const fmt = (n: number) => formatCurrencyString(n, { digits: 0 });

  return (
    <div dir={dir} className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 shadow-sm overflow-hidden space-y-4 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900">{t('portfolioPeriodPnLTitle')}</h3>
            <InfoHint
              text={t('portfolioPeriodPnLHint')}
              hintId="portfolio-period-pnl"
              hintPage="Wealth Analytics"
            />
          </div>
          <p className="mt-1 text-sm text-slate-600 max-w-prose">{t('portfolioPeriodPnLSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm shrink-0">
          <div className="text-end">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('weekPnL')}</p>
            <PnLCell value={summary.weeklyTotalSar} format={fmt} mask={maskBalance} />
          </div>
          <div className="text-end">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('monthPnL')}</p>
            <PnLCell value={summary.monthlyTotalSar} format={fmt} mask={maskBalance} />
          </div>
        </div>
      </div>

      <PortfolioPnLTrendCharts
        weekly={dailySeries.weekly}
        monthly={dailySeries.monthly}
        weeklyTotalSar={summary.weeklyTotalSar}
        monthlyTotalSar={summary.monthlyTotalSar}
      />

      <CollapsibleSection
        title={t('portfolioDetailsTable')}
        summary={`${summary.rows.length} portfolios`}
        defaultExpanded={false}
        className="mb-0 border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-white/80">
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 text-start">{t('portfolioLabel')}</th>
                <th className="px-3 py-2.5 text-end">{t('weekPnL')}</th>
                <th className="px-3 py-2.5 text-end hidden md:table-cell">{t('weekLedgerShort')}</th>
                <th className="px-3 py-2.5 text-end hidden lg:table-cell">{t('weekMarketShort')}</th>
                <th className="px-3 py-2.5 text-end">{t('monthPnL')}</th>
                <th className="px-3 py-2.5 text-end hidden md:table-cell">{t('monthLedgerShort')}</th>
                <th className="px-3 py-2.5 text-end hidden lg:table-cell">{t('monthMarketShort')}</th>
                <th className="px-3 py-2.5 text-end">{t('todayPnL')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.portfolioId} className="border-t border-slate-100 hover:bg-white/70 transition-colors">
                  <td className="px-4 py-3 text-start min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{row.portfolioName}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {maskBalance(fmt(row.valueSar))} · {row.bookCurrency}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-end">
                    <PnLCell value={row.weekly.totalSar} format={fmt} mask={maskBalance} />
                  </td>
                  <td className="px-3 py-3 text-end hidden md:table-cell text-slate-600 tabular-nums text-xs">
                    {maskBalance(fmt(row.weekly.ledgerSar))}
                  </td>
                  <td className="px-3 py-3 text-end hidden lg:table-cell text-slate-600 tabular-nums text-xs">
                    {maskBalance(fmt(row.weekly.marketEstimateSar))}
                  </td>
                  <td className="px-3 py-3 text-end">
                    <PnLCell value={row.monthly.totalSar} format={fmt} mask={maskBalance} />
                  </td>
                  <td className="px-3 py-3 text-end hidden md:table-cell text-slate-600 tabular-nums text-xs">
                    {maskBalance(fmt(row.monthly.ledgerSar))}
                  </td>
                  <td className="px-3 py-3 text-end hidden lg:table-cell text-slate-600 tabular-nums text-xs">
                    {maskBalance(fmt(row.monthly.marketEstimateSar))}
                  </td>
                  <td className="px-3 py-3 text-end">
                    <PnLCell value={row.dailyPnLSar} format={fmt} mask={maskBalance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {setActivePage && (
        <div className="text-end pt-1">
          <button
            type="button"
            onClick={() => setActivePage('Investments')}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {t('openInvestmentsHub')} →
          </button>
        </div>
      )}
    </div>
  );
};

export default PortfolioPeriodPnLPanel;
