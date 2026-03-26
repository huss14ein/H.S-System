import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

export interface HistoricalPoint {
    day: number;
    price: number;
}

/**
 * Generate an illustrative trend shape (not real historical data).
 * Curve is scaled so the last point = currentPrice and biased by changePercent.
 * Use only when historicalData is not provided.
 */
function generateIllustrativeTrendData(currentPrice?: number, changePercent?: number): HistoricalPoint[] {
    const data: HistoricalPoint[] = [];
    let price = 100;
    const seed = Math.sin(42) * 100;
    for (let i = 0; i <= 30; i++) {
        price += (Math.sin((i + seed) * 0.4) * 0.5 + (changePercent != null ? (changePercent / 100) * (i / 30) : 0)) * (price * 0.02);
        price = Math.max(price, 1);
        data.push({ day: i, price });
    }
    if (currentPrice != null && currentPrice > 0 && data.length > 0) {
        const last = data[data.length - 1].price;
        const scale = currentPrice / last;
        data.forEach(d => { d.price = Math.round(d.price * scale * 100) / 100; });
    }
    return data;
}

interface MiniPriceChartProps {
    symbol?: string;
    currentPrice?: number;
    changePercent?: number;
    /** Optional: format price for display */
    formatPrice?: (p: number) => string;
    /** When true, show a small "Illustrative" label so users know this is not real historical data */
    showIllustrativeLabel?: boolean;
    /** Real 1-month daily data (day index, close price). When provided, chart and 1M trend % use this. */
    historicalData?: HistoricalPoint[] | null;
    /** When true, avoid synthetic curves and show unavailable state unless real data exists. */
    realDataOnly?: boolean;
}

const MiniPriceChart: React.FC<MiniPriceChartProps> = ({ symbol, currentPrice, changePercent, formatPrice = (p: number) => p.toFixed(2), showIllustrativeLabel = false, historicalData, realDataOnly = false }) => {
    const data = useMemo(() => {
        if (historicalData && historicalData.length > 0) return [...historicalData].sort((a, b) => a.day - b.day);
        if (realDataOnly) return [] as HistoricalPoint[];
        return generateIllustrativeTrendData(currentPrice, changePercent);
    }, [historicalData, currentPrice, changePercent, realDataOnly]);
    const isUp = data.length > 0 && data[data.length - 1].price >= data[0].price;
    const color = isUp ? '#22c55e' : '#ef4444';
    const startPrice = data.length > 0 ? data[0].price : 0;
    const endPrice = data.length > 0 ? data[data.length - 1].price : 0;
    const isRealData = Boolean(historicalData && historicalData.length > 0);
    const trendPct = startPrice > 0 && data.length >= 2 ? ((endPrice - startPrice) / startPrice) * 100 : null;

    if (realDataOnly && data.length === 0) {
        return (
            <div className="w-full min-w-[120px]">
                <div className="flex items-center justify-between text-xs mb-0.5 gap-1 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-medium" title="No daily history returned for this symbol">
                        1M unavailable
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">—</span>
                </div>
                <div
                    className="flex h-14 w-full items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/80 text-[10px] text-slate-400"
                    aria-hidden
                >
                    No series
                </div>
            </div>
        );
    }

    return (
        <div className="w-full min-w-[120px]">
            <div className="flex items-center justify-between text-xs mb-0.5 gap-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                    {currentPrice != null && currentPrice > 0 && (
                        <span className="font-semibold text-gray-800 tabular-nums">{formatPrice(currentPrice)}</span>
                    )}
                    {showIllustrativeLabel && !isRealData && (
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide" title="Chart shape is illustrative; no real 1-month history available for this symbol">Illustrative</span>
                    )}
                    {showIllustrativeLabel && isRealData && (
                        <span className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide" title="Real 1-month daily close history">1M</span>
                    )}
                </div>
                {trendPct !== null ? (
                    <span className={`font-medium tabular-nums ${trendPct >= 0 ? 'text-green-600' : 'text-red-600'}`} title="1-month change">
                        {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(2)}%
                    </span>
                ) : (
                    <span className="text-[10px] text-slate-400 font-medium" title={realDataOnly ? 'Real 1-month trend is unavailable for this symbol' : '1-month trend not available'}>—</span>
                )}
            </div>
            <div style={{ width: '100%', height: 56 }}>
                <ResponsiveContainer>
                    <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`colorPrice-${symbol ?? 'def'}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.4}/>
                                <stop offset="95%" stopColor={color} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0].payload?.price;
                                return (
                                    <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg">
                                        {p != null ? formatPrice(p) : '—'}
                                    </div>
                                );
                            }}
                        />
                        <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#colorPrice-${symbol ?? 'def'})`} dot={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default MiniPriceChart;
