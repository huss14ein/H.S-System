
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
                <text x={x + width / 2} y={y + height / 2 + 16} textAnchor="middle" fill={textColor} fontSize={12}>
                    {gainLossPercent.toFixed(2)}%
                </text>
            ) : null}
        </g>
    );
};

const TreemapTooltip: React.FC<any> = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const { name, size, gainLossPercent } = payload[0].payload;
        return (
            <div className="bg-white p-2 border border-gray-300 rounded shadow-lg text-sm">
                <p className="font-bold">{name}</p>
                <p>Market Value: {`SAR ${size.toLocaleString()}`}</p>
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

    // Creates a color gradient from red to green
    const getColor = (percentage: number) => {
        if (percentage < -5) return '#ef4444'; // red-500
        if (percentage < 0) return '#f87171'; // red-400
        if (percentage === 0) return '#a1a1aa'; // zinc-400
        if (percentage < 5) return '#4ade80'; // green-400
        return '#22c55e'; // green-500
    };


    return (
        <ResponsiveContainer width="100%" height="100%">
            <Treemap
                width={400}
                height={200}
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
