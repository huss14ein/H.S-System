import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

const generateMockData = () => {
    const data = [];
    let price = 50 + Math.random() * 150;
    for (let i = 30; i >= 0; i--) {
        price += (Math.random() - 0.5) * (price * 0.05); // More realistic percentage-based change
        price = Math.max(price, 10); // ensure price doesn't go negative
        data.push({
            day: i,
            price: price,
        });
    }
    return data.reverse();
};

const MiniPriceChart: React.FC = () => {
    const data = useMemo(() => generateMockData(), []);
    const isUp = data[data.length-1].price >= data[0].price;
    const color = isUp ? '#22c55e' : '#ef4444';

    return (
        <div style={{ width: '100%', height: 120 }}>
            <ResponsiveContainer>
                <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                     <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.4}/>
                            <stop offset="95%" stopColor={color} stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <Tooltip 
                        contentStyle={{ display: 'none' }}
                    />
                    <Area type="monotone" dataKey="price" stroke={color} strokeWidth={2} fill="url(#colorPrice)" dot={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default MiniPriceChart;
