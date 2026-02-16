import React from 'react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';

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

const TreemapTooltip: React.FC<any> = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const { name, size, gainLossPercent } = payload[0].payload;
        return (
            <div className="bg-white/80 backdrop-blur-sm p-3 border border-gray-200 rounded-lg shadow-lg text-sm">
                <p className="font-bold text-dark">{name}</p>
                <p className="text-gray-600">Market Value: {`SAR ${size.toLocaleString()}`}</p>
                <p className={gainLossPercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                    Performance: {gainLossPercent.toFixed(2)}%
                </p>
            </div>
        );
    }
    return null;
};

const PerformanceTreemap: React.FC<{ data: any[] }> = ({ data }) => {
    
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
    
    const processedData = data.map(item => ({
        name: item.symbol,
        size: item.currentValue,
        gainLossPercent: item.gainLossPercent,
        color: getColor(item.gainLossPercent),
    }));

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
                <Tooltip content={<TreemapTooltip />} />
            </Treemap>
        </ResponsiveContainer>
    );
};


export default PerformanceTreemap;