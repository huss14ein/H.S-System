import React, { useState, useMemo, useContext } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';
import { useCurrency } from '../../context/CurrencyContext';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from '../../services/fxDailySeries';
import { computePersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';
import { listNetWorthSnapshots } from '../../services/netWorthSnapshot';
import InfoHint from '../InfoHint';

type TimePeriod = 'Day' | 'Week' | 'Month' | '6M' | '1Y' | '3Y' | 'All';

const PERIOD_LABELS: Record<TimePeriod, string> = {
  Day: 'Day',
  Week: 'Week',
  Month: 'Month',
  '6M': '6 mo',
  '1Y': '1Y',
  '3Y': '3Y',
  All: 'All',
};

const RECEIVABLES_COLOR = CHART_COLORS.categorical[1];

const NetWorthCompositionChart: React.FC<{ title: string }> = ({ title }) => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');

    const chartData = useMemo(() => {
        if (!data) return [];
        const snapshots = listNetWorthSnapshots();
        const oldestDay = snapshots.reduce<string | undefined>((min, s) => {
            const d = typeof s.at === 'string' ? s.at.slice(0, 10) : '';
            if (d.length !== 10) return min;
            if (!min || d < min) return d;
            return min;
        }, undefined);
        hydrateSarPerUsdDailySeries(data, exchangeRate, {
            horizonDays: 4000,
            earliestCalendarDay: oldestDay,
        });
        const todayKey = new Date().toISOString().slice(0, 10);
        const fxToday = getSarPerUsdForCalendarDay(todayKey, data, exchangeRate);
        const buckets = computePersonalNetWorthChartBucketsSAR(data, fxToday, { getAvailableCashForAccount });
        const monthly = new Map<string, {
            date: string;
            netWorth: number;
            cash: number;
            investments: number;
            physical: number;
            receivables: number;
            liabilities: number;
        }>();

        snapshots.forEach((s) => {
            const key = s.at.slice(0, 7);
            const existing = monthly.get(key);
            if (existing && existing.date >= s.at) return;
            const b = s.buckets;
            const hasBuckets = !!b;
            monthly.set(key, {
                date: s.at,
                netWorth: Number(s.netWorth) || 0,
                cash: hasBuckets ? (Number(b!.cash) || 0) : 0,
                investments: hasBuckets ? (Number(b!.investments) || 0) : 0,
                physical: hasBuckets ? (Number(b!.physicalAndCommodities) || 0) : 0,
                receivables: hasBuckets ? (Number(b!.receivables) || 0) : 0,
                liabilities: hasBuckets ? (Number(b!.liabilities) || 0) : 0,
            });
        });

        // Ensure the latest current month point is always present from live data.
        const currentDate = new Date().toISOString();
        const currentKey = currentDate.slice(0, 7);
        monthly.set(currentKey, {
            date: currentDate,
            netWorth: Math.round(buckets.netWorth),
            cash: Math.round(buckets.cash),
            investments: Math.round(buckets.investments),
            physical: Math.round(buckets.physicalAndCommodities),
            receivables: Math.round(buckets.receivables),
            liabilities: Math.round(buckets.liabilities),
        });

        const finalData = Array.from(monthly.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((x) => ({
                date: x.date,
                name: new Date(x.date).toLocaleString('en-US', { month: 'short', year: '2-digit' }),
                'Net Worth': Math.round(x.netWorth),
                Cash: Math.round(x.cash),
                Investments: Math.round(x.investments),
                Physical: Math.round(x.physical),
                Receivables: Math.round(x.receivables),
                Liabilities: Math.round(x.liabilities),
            }));

        const nowFilter = new Date();
        const startOfToday = new Date(nowFilter.getFullYear(), nowFilter.getMonth(), nowFilter.getDate());
        switch (timePeriod) {
            case 'Day': {
                const start = new Date(startOfToday);
                start.setDate(start.getDate() - 1);
                return finalData.filter((d) => new Date(d.date as string) >= start);
            }
            case 'Week': {
                const start = new Date(startOfToday);
                start.setDate(start.getDate() - 7);
                return finalData.filter((d) => new Date(d.date as string) >= start);
            }
            case 'Month': {
                const y = nowFilter.getFullYear();
                const m = nowFilter.getMonth();
                return finalData.filter((d) => {
                    const dt = new Date(d.date as string);
                    return dt.getFullYear() === y && dt.getMonth() === m;
                });
            }
            case '6M': {
                const target = new Date(nowFilter);
                target.setMonth(target.getMonth() - 6);
                return finalData.filter((d) => new Date(d.date as string) >= target);
            }
            case '1Y': {
                const targetDate = new Date(nowFilter);
                targetDate.setFullYear(targetDate.getFullYear() - 1);
                return finalData.filter((d) => new Date(d.date as string) >= targetDate);
            }
            case '3Y': {
                const targetDate = new Date(nowFilter);
                targetDate.setFullYear(targetDate.getFullYear() - 3);
                return finalData.filter((d) => new Date(d.date as string) >= targetDate);
            }
            case 'All':
            default:
                return finalData;
        }
    }, [data, timePeriod, exchangeRate, getAvailableCashForAccount]);

    const isEmpty = !chartData?.length;

    return (
        <div className="h-full flex flex-col min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4 min-w-0">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-dark inline-flex items-center gap-1.5 flex-wrap">
                        {title}
                        <InfoHint
                            placement="bottom"
                            text="History is stored as monthly snapshot points. Shorter ranges (day/week/month) filter those points; very short windows may show one month until more history exists."
                        />
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-xl">
                        Historical rows use stored monthly snapshots (SAR at capture). The latest month is recomputed from your books using today’s rate from the SAR/USD daily series (Wealth Ultra / snapshots, forward-filled). The series is hydrated back to your oldest snapshot so past days don’t fall back to a single spot.
                    </p>
                </div>
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg shrink-0 max-w-full justify-end">
                    {(['Day', 'Week', 'Month', '6M', '1Y', '3Y', 'All'] as TimePeriod[]).map((period) => (
                        <button
                            key={period}
                            type="button"
                            onClick={() => setTimePeriod(period)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                                timePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {PERIOD_LABELS[period]}
                        </button>
                    ))}
                </div>
            </div>
            <ChartContainer height="100%" isEmpty={isEmpty} emptyMessage="No net worth history. Add accounts and transactions to see composition over time." className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ ...CHART_MARGIN, right: 30, left: 20 }} stackOffset="sign">
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" fontSize={12} stroke={CHART_AXIS_COLOR} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} width={56} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip
                            formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
                            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                        />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <defs>
                            <linearGradient id="chartColorCash" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorInvestments" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorPhysical" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorReceivables" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={RECEIVABLES_COLOR} stopOpacity={0.75} />
                                <stop offset="95%" stopColor={RECEIVABLES_COLOR} stopOpacity={0.12} />
                            </linearGradient>
                            <linearGradient id="chartColorLiabilities" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.liability} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.liability} stopOpacity={0.1} />
                            </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="Cash" name="Cash" stackId="1" stroke={CHART_COLORS.primary} fill="url(#chartColorCash)" />
                        <Area type="monotone" dataKey="Investments" name="Investments" stackId="1" stroke={CHART_COLORS.secondary} fill="url(#chartColorInvestments)" />
                        <Area type="monotone" dataKey="Physical" name="Physical & commodities" stackId="1" stroke={CHART_COLORS.tertiary} fill="url(#chartColorPhysical)" />
                        <Area type="monotone" dataKey="Receivables" name="Receivables" stackId="1" stroke={RECEIVABLES_COLOR} fill="url(#chartColorReceivables)" />
                        <Area type="monotone" dataKey="Liabilities" name="Debt" stackId="2" stroke={CHART_COLORS.liability} fill="url(#chartColorLiabilities)" />
                    </AreaChart>
                </ResponsiveContainer>
            </ChartContainer>
        </div>
    );
};

export default NetWorthCompositionChart;
