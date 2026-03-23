import React, { useState, useMemo, useContext } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';
import { useCurrency } from '../../context/CurrencyContext';
import { resolveSarPerUsd } from '../../utils/currencyMath';
import { computePersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';

type TimePeriod = '1Y' | '3Y' | 'All';

const RECEIVABLES_COLOR = CHART_COLORS.categorical[1];

const NetWorthCompositionChart: React.FC<{ title: string }> = ({ title }) => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');

    const chartData = useMemo(() => {
        if (!data) return [];
        const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
        const fullHistoricalData: Array<Record<string, string | number>> = [];
        const now = new Date();

        const buckets = computePersonalNetWorthChartBucketsSAR(data, sarPerUsd, { getAvailableCashForAccount });

        const transactions = (data as { personalTransactions?: { date: string; amount?: number }[] }).personalTransactions ?? data.transactions ?? [];
        const monthlyNetFlows = new Map<string, number>();
        transactions.forEach((t) => {
            const monthKey = t.date.slice(0, 7);
            const currentFlow = monthlyNetFlows.get(monthKey) || 0;
            monthlyNetFlows.set(monthKey, currentFlow + (Number(t.amount) || 0));
        });

        let cash = buckets.cash;
        let invVal = buckets.investments;
        let physical = buckets.physicalAndCommodities;
        let recVal = buckets.receivables;
        let liabVal = buckets.liabilities;

        const monthsToGoBack = 60;

        for (let i = 0; i <= monthsToGoBack; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = date.toISOString().slice(0, 7);

            const netWorth = cash + invVal + physical + recVal + liabVal;

            fullHistoricalData.push({
                date: date.toISOString(),
                name: date.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
                'Net Worth': Math.round(netWorth),
                Cash: Math.round(cash),
                Investments: Math.round(invVal),
                Physical: Math.round(physical),
                Receivables: Math.round(recVal),
                Liabilities: Math.round(liabVal),
            });

            const netFlowThisMonth = monthlyNetFlows.get(monthKey) || 0;
            cash -= netFlowThisMonth;
            invVal /= 1 + 0.07 / 12;
            physical /= 1.003;
            if (liabVal < -500000) {
                liabVal += 4500;
            }
        }

        const finalData = fullHistoricalData.reverse();

        const nowFilter = new Date();
        const nowCopy1 = new Date(nowFilter);
        const nowCopy2 = new Date(nowFilter);
        switch (timePeriod) {
            case '1Y': {
                const targetDate = new Date(nowCopy1.setFullYear(nowCopy1.getFullYear() - 1));
                return finalData.filter((d) => new Date(d.date as string) >= targetDate);
            }
            case '3Y': {
                const targetDate = new Date(nowCopy2.setFullYear(nowCopy2.getFullYear() - 3));
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
                    <h3 className="text-lg font-semibold text-dark">{title}</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-xl">
                        The latest month uses your full personal balance sheet (same as net worth above). Earlier months are a simplified backward model, not stored history.
                    </p>
                </div>
                <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg shrink-0">
                    {(['1Y', '3Y', 'All'] as TimePeriod[]).map((period) => (
                        <button
                            key={period}
                            type="button"
                            onClick={() => setTimePeriod(period)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                timePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {period}
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
