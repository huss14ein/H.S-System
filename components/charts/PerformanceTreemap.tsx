import React from 'react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';

const CustomizedContent: React.FC<any> = ({ depth, x, y, width, height, index, colors, name, gainLossPercent }) => {
    // Determine text color based on background darkness
    const textColor = depth === 1 ? 'white' : 'black';

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                style={{
                    fill: colors[index % colors.length],
                    stroke: '#fff',
                    strokeWidth: 2 / (depth + 1e-10),
                    strokeOpacity: 1 / (depth + 1e-10),
                }}
            />
            {depth === 1 && width > 50 && height > 25 ? (
                <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fill={textColor} fontSize={14} fontWeight="bold">
                    {name}
                </text>
            ) : null}
             {depth === 1 && width > 60 && height > 40 ? (
                <text x={x + width / 2} y={y + height / 2 + 16} textAnchor="middle" fill={textColor} fontSize={12} opacity={0.8}>
                    {gainLossPercent.toFixed(1)}%
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
    
    const processedData = data.map(item => ({
        name: item.symbol,
        size: item.currentValue,
        gainLossPercent: item.gainLossPercent
    }));

    const getColor = (percentage: number) => {
        const clampedPercent = Math.max(-10, Math.min(10, percentage));
        const normalized = (clampedPercent + 10) / 20;

        // Red (239, 68, 68) -> Yellow (250, 204, 21) -> Green (34, 197, 94)
        let r, g, b;
        if (normalized < 0.5) {
            const t = normalized * 2; // 0 -> 1 for red to yellow
            r = 239 + (250 - 239) * t;
            g = 68 + (204 - 68) * t;
            b = 68 + (21 - 68) * t;
        } else {
            const t = (normalized - 0.5) * 2; // 0 -> 1 for yellow to green
            r = 250 + (34 - 250) * t;
            g = 204 + (197 - 204) * t;
            b = 21 + (94 - 21) * t;
        }

        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <Treemap
                isAnimationActive={false} // Better for performance with dynamic colors
                data={processedData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="#fff"
                content={<CustomizedContent colors={processedData.map(d => getColor(d.gainLossPercent))} />}
            >
                <Tooltip content={<TreemapTooltip />} />
            </Treemap>
        </ResponsiveContainer>
    );
};


export default PerformanceTreemap;
