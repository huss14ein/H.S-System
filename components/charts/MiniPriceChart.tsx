import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

/** Generate 30-day trend shape; if currentPrice provided, scale so last point = currentPrice. */
function generateTrendData(currentPrice?: number, changePercent?: number): { day: number; price: number }[] {
    const data: { day: number; price: number }[] = [];
    let price = 100;
    const seed = Math.sin(42) * 100; // deterministic per-session shape
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
}

const MiniPriceChart: React.FC<MiniPriceChartProps> = ({ symbol, currentPrice, changePercent, formatPrice = (p: number) => p.toFixed(2) }) => {
    const data = useMemo(() => generateTrendData(currentPrice, changePercent), [currentPrice, changePercent]);
    const isUp = data.length > 0 && data[data.length - 1].price >= data[0].price;
    const color = isUp ? '#22c55e' : '#ef4444';
    const startPrice = data.length > 0 ? data[0].price : 0;
    const endPrice = data.length > 0 ? data[data.length - 1].price : 0;
    const trendPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : (changePercent ?? 0);

    return (
        <div className="w-full min-w-[120px]">
            <div className="flex items-center justify-between text-xs mb-0.5">
                {currentPrice != null && currentPrice > 0 && (
                    <span className="font-semibold text-gray-800 tabular-nums">{formatPrice(currentPrice)}</span>
                )}
                <span className={`font-medium tabular-nums ${trendPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(2)}%
                </span>
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
