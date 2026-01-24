
import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';

export type TimePeriod = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'All';

interface NetWorthChartProps {
  period: TimePeriod;
}

// Generate more comprehensive mock data for up to 3 years
const generateMockData = () => {
  const data = [];
  const now = new Date();
  let currentNetWorth = 1500000;
  const days = 3 * 365;

  for (let i = days; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    currentNetWorth += (Math.random() - 0.49) * 2000; // Simulate daily growth with volatility
    data.push({
      date: date.toISOString(),
      name: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      netWorth: Math.round(currentNetWorth),
    });
  }
  return data;
};

const fullData = generateMockData();


const NetWorthChart: React.FC<NetWorthChartProps> = ({ period }) => {
  const filteredData = useMemo(() => {
    const now = new Date();
    switch (period) {
      case '1M': {
        const targetDate = new Date(now.setMonth(now.getMonth() - 1));
        return fullData.filter(d => new Date(d.date) >= targetDate);
      }
      case '3M': {
        const targetDate = new Date(now.setMonth(now.getMonth() - 3));
        return fullData.filter(d => new Date(d.date) >= targetDate);
      }
      case '6M': {
        const targetDate = new Date(now.setMonth(now.getMonth() - 6));
        return fullData.filter(d => new Date(d.date) >= targetDate);
      }
      case 'YTD': {
        const targetDate = new Date(now.getFullYear(), 0, 1);
        return fullData.filter(d => new Date(d.date) >= targetDate);
      }
      case '1Y': {
        const targetDate = new Date(now.setFullYear(now.getFullYear() - 1));
        return fullData.filter(d => new Date(d.date) >= targetDate);
      }
      case 'All':
      default:
        return fullData;
    }
  }, [period]);

  const getInterval = (data: any[]) => {
      if (data.length <= 31) return Math.floor(data.length / 7); // ~weekly ticks for 1M
      if (data.length <= 180) return Math.floor(data.length / 6); // ~monthly ticks for 3M/6M
      return Math.floor(data.length / 12); // ~monthly ticks for 1Y/All
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={filteredData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
        <defs>
            <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
            </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis 
          dataKey="name" 
          stroke="#6b7280" 
          fontSize={12}
          interval={getInterval(filteredData)}
          angle={filteredData.length > 180 ? -30 : 0}
          dy={filteredData.length > 180 ? 10 : 0}
        />
        <YAxis 
          tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
          stroke="#6b7280"
          domain={['dataMin - 100000', 'dataMax + 100000']}
        />
        <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '0.5rem' }}
            formatter={(value) => [`SAR ${Number(value).toLocaleString()}`, "Net Worth"]}
        />
        <Legend />
        <ReferenceLine y={0} stroke="#b91c1c" strokeWidth={1} strokeDasharray="3 3" />
        <Area type="monotone" dataKey="netWorth" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#colorNetWorth)" />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default NetWorthChart;