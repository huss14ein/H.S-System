import React, { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { PortfolioPnLDailyPoint } from '../../services/portfolioPeriodPnL';

export const MiniPnLSparkline: React.FC<{
  points: PortfolioPnLDailyPoint[];
  className?: string;
  height?: number;
}> = ({ points, className = '', height = 36 }) => {
  const data = useMemo(
    () => points.map((p) => ({ v: p.cumulativeSar })),
    [points],
  );
  const positive = (points.length > 0 ? points[points.length - 1].cumulativeSar : 0) >= 0;
  const stroke = positive ? '#059669' : '#e11d48';
  const fill = positive ? '#a7f3d0' : '#fecdd3';

  if (data.length < 2) return null;

  return (
    <div className={`w-full min-w-[72px] ${className}`} aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area type="monotone" dataKey="v" stroke={stroke} fill={fill} fillOpacity={0.45} strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MiniPnLSparkline;
