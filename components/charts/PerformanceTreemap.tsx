import React from 'react';
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
                <p className="font-semibold text-slate-800 truncate">{name}</p>
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
    
    const processedData = data
        .filter(item => item.currentValue > 0)
        .map(item => ({
            name: item.symbol,
            size: item.currentValue,
            gainLossPercent: item.gainLossPercent,
            color: getColor(item.gainLossPercent),
        }));

    if (!processedData.length) {
        return (
            <div className="flex items-center justify-center h-full w-full bg-gray-50 rounded-lg text-gray-500 text-sm">
                No investment data available.
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <Treemap
                isAnimationActive={true}
                animationDuration={800}
                data={processedData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="#fff"
                content={<CustomizedContent />}
            >
                <Tooltip content={<TreemapTooltip formatValue={(n) => formatCurrencyString(n, { digits: 0 })} />} />
            </Treemap>
        </ResponsiveContainer>
    );
};


export default PerformanceTreemap;