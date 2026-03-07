import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

const CustomizedContent: React.FC<any> = ({ depth, x, y, width, height, name, gainLossPercent, color }) => {
    const textColor = 'white';
    const fontSize = Math.min(width / 4, height / 2.5, 16);

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={4}
                ry={4}
                style={{
                    fill: color,
                    stroke: '#fff',
                    strokeWidth: 2,
                    strokeOpacity: 1,
                }}
            />
            {depth === 1 && width > 50 && height > 25 ? (
                <text x={x + width / 2} y={y + height / 2} dy=".35em" textAnchor="middle" fill={textColor} style={{ fontSize: `${fontSize}px`, fontWeight: 'bold' }}>
                    <tspan x={x + width / 2} dy="-0.5em">{name}</tspan>
                    <tspan x={x + width / 2} dy="1.2em" style={{ opacity: 0.8, fontSize: `${fontSize * 0.8}px` }}>{(gainLossPercent ?? 0).toFixed(1)}%</tspan>
                </text>
            ) : null}
        </g>
    );
};

const TreemapTooltip: React.FC<{ active?: boolean; payload?: any[]; formatValue?: (n: number) => string }> = ({ active, payload, formatValue }) => {
    if (active && payload && payload.length) {
        const { name, size, gainLossPercent } = payload[0].payload;
        const fmt = formatValue ?? ((n: number) => new Intl.NumberFormat('en-US', { style: 'currency', minimumFractionDigits: 0 }).format(n));
        return (
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-sm min-w-[140px]">
                <p className="font-semibold text-slate-800 break-words leading-tight" title={name}>{name}</p>
                <p className="text-slate-600">Market value: {fmt(size)}</p>
                <p className={gainLossPercent >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                    Performance: {gainLossPercent.toFixed(2)}%
                </p>
            </div>
        );
    }
    return null;
};

const PerformanceTreemap: React.FC<{ data: any[] }> = ({ data }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
        syncPreference();
        mediaQuery.addEventListener('change', syncPreference);
        return () => mediaQuery.removeEventListener('change', syncPreference);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const node = containerRef.current;
        if (!node) return;
        const syncSize = () => setContainerWidth(node.getBoundingClientRect().width);
        syncSize();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncSize()) : null;
        observer?.observe(node);
        window.addEventListener('resize', syncSize);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', syncSize);
        };
    }, []);

    const getColor = (percentage: number) => {
        if (isNaN(percentage) || !isFinite(percentage)) {
            return '#9ca3af'; // slate-400, a neutral gray
        }
        const clampedPercent = Math.max(-25, Math.min(25, percentage));
        const normalized = (clampedPercent + 25) / 50;

        const r_loss = 220, g_loss = 38, b_loss = 38; // red-600
        const r_neutral = 156, g_neutral = 163, b_neutral = 175; // gray-500
        const r_gain = 22, g_gain = 163, b_gain = 74; // green-600
        
        let r, g, b;
        if (normalized < 0.5) {
            const t = normalized * 2;
            r = r_loss + (r_neutral - r_loss) * t;
            g = g_loss + (g_neutral - g_loss) * t;
            b = b_loss + (b_neutral - b_loss) * t;
        } else {
            const t = (normalized - 0.5) * 2;
            r = r_neutral + (r_gain - r_neutral) * t;
            g = g_neutral + (g_gain - g_neutral) * t;
            b = b_neutral + (b_gain - b_neutral) * t;
        }

        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    };
    
    const processedData = useMemo(() => (
        data
            .map(item => {
                const marketValue = Number(item.currentValue ?? 0);
                const fallbackCostValue = Number(item.avgCost ?? 0) * Number(item.quantity ?? 0);
                const size = Number.isFinite(marketValue) && marketValue > 0
                    ? marketValue
                    : Number.isFinite(fallbackCostValue) && fallbackCostValue > 0
                    ? fallbackCostValue
                    : 0;

                if (size <= 0) return null;

                return {
                    name: item.symbol || item.name || 'Unknown',
                    size,
                    gainLossPercent: Number.isFinite(item.gainLossPercent) ? item.gainLossPercent : 0,
                    color: getColor(item.gainLossPercent),
                };
            })
            .filter((item): item is { name: string; size: number; gainLossPercent: number; color: string } => Boolean(item))
    ), [data]);

    const enableAnimation = processedData.length <= 60 && !prefersReducedMotion;

    if (!processedData.length) {
        return (
            <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600 px-6">
                No priced holdings yet. Add live prices (or cost basis) to render the performance treemap.
            </div>
        );
    }

    if (processedData.length === 1) {
        const item = processedData[0];
        return (
            <div className="h-full min-h-[320px] w-full rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
                <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Single holding view</p>
                    <p className="mt-2 text-lg font-bold text-slate-800 break-words">{item.name}</p>
                    <p className="text-sm text-slate-600 mt-1">Market value: {formatCurrencyString(item.size, { digits: 0 })}</p>
                    <p className={`text-sm font-semibold mt-1 ${item.gainLossPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        Performance: {item.gainLossPercent.toFixed(2)}%
                    </p>
                </div>
                <div className="mt-4 h-24 rounded-lg" style={{ background: item.color }} />
            </div>
        );
    }

    if (containerWidth < 120) {
        return (
            <div ref={containerRef} className="flex h-full min-h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600 px-6">
                Preparing holdings chart…
            </div>
        );
    }

    return (
        <div ref={containerRef} className="h-full min-h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <Treemap
                    isAnimationActive={enableAnimation}
                    animationDuration={enableAnimation ? 800 : 0}
                    data={processedData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="#fff"
                    content={<CustomizedContent />}
                >
                    <Tooltip content={<TreemapTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
                </Treemap>
            </ResponsiveContainer>
        </div>
    );
};


export default PerformanceTreemap;
